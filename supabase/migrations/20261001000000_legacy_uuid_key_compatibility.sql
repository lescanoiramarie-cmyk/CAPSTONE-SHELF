-- The original hosted database used UUID keys for books and visitors, while
-- the checked-in schema and application use text IDs. Preserve existing ID
-- values as strings and convert their foreign keys before feature migrations.
create temporary table shelf_legacy_foreign_keys
on commit drop
as
select
  constraint_row.conrelid::regclass as table_name,
  constraint_row.conname as constraint_name,
  pg_get_constraintdef(constraint_row.oid) as definition,
  constraint_row.convalidated as is_validated
from pg_constraint as constraint_row
join pg_class as referencing_table
  on referencing_table.oid = constraint_row.conrelid
join pg_namespace as referencing_schema
  on referencing_schema.oid = referencing_table.relnamespace
where constraint_row.contype = 'f'
  and constraint_row.confrelid in (
    'public.books'::regclass,
    'public.visitors'::regclass
  )
  and referencing_schema.nspname = 'public';

create temporary table shelf_legacy_foreign_key_columns
on commit drop
as
select distinct
  constraint_row.conrelid::regclass as table_name,
  attribute_row.attname as column_name
from pg_constraint as constraint_row
cross join lateral unnest(constraint_row.conkey) as key_column(attnum)
join pg_attribute as attribute_row
  on attribute_row.attrelid = constraint_row.conrelid
  and attribute_row.attnum = key_column.attnum
join pg_class as referencing_table
  on referencing_table.oid = constraint_row.conrelid
join pg_namespace as referencing_schema
  on referencing_schema.oid = referencing_table.relnamespace
where constraint_row.contype = 'f'
  and constraint_row.confrelid in (
    'public.books'::regclass,
    'public.visitors'::regclass
  )
  and referencing_schema.nspname = 'public';

create temporary table shelf_legacy_impacted_columns
on commit drop
as
select
  foreign_key_column.table_name::oid as table_oid,
  attribute_row.attnum as column_number
from shelf_legacy_foreign_key_columns as foreign_key_column
join pg_attribute as attribute_row
  on attribute_row.attrelid = foreign_key_column.table_name::oid
  and attribute_row.attname = foreign_key_column.column_name
  and not attribute_row.attisdropped
union
select
  key_table.table_name::oid,
  attribute_row.attnum
from (values
  ('public.books'::regclass, 'id'::text),
  ('public.visitors'::regclass, 'id'::text)
) as key_table(table_name, column_name)
join pg_attribute as attribute_row
  on attribute_row.attrelid = key_table.table_name::oid
  and attribute_row.attname = key_table.column_name
  and not attribute_row.attisdropped;

do $$
declare
  foreign_key_row record;
  foreign_key_column record;
  key_row record;
  policy_row record;
  key_type text;
begin
  for policy_row in
    select distinct
      policy_table.oid::regclass as table_name,
      policy.polname as policy_name
    from pg_policy as policy
    join pg_class as policy_table
      on policy_table.oid = policy.polrelid
    join pg_depend as dependency
      on dependency.classid = 'pg_policy'::regclass
      and dependency.objid = policy.oid
    join shelf_legacy_impacted_columns as impacted_column
      on dependency.refclassid = 'pg_class'::regclass
      and dependency.refobjid = impacted_column.table_oid
      and dependency.refobjsubid = impacted_column.column_number
  loop
    execute format(
      'drop policy %I on %s',
      policy_row.policy_name,
      policy_row.table_name
    );
  end loop;

  for foreign_key_row in
    select * from shelf_legacy_foreign_keys
  loop
    execute format(
      'alter table %s drop constraint %I',
      foreign_key_row.table_name,
      foreign_key_row.constraint_name
    );
  end loop;

  for foreign_key_column in
    select * from shelf_legacy_foreign_key_columns
  loop
    select type_info.typname
    into key_type
    from pg_attribute as attribute_info
    join pg_type as type_info
      on type_info.oid = attribute_info.atttypid
    where attribute_info.attrelid =
      foreign_key_column.table_name::oid
      and attribute_info.attname = foreign_key_column.column_name
      and not attribute_info.attisdropped;

    if key_type = 'uuid' then
      execute format(
        'alter table %s alter column %I type text using %I::text',
        foreign_key_column.table_name,
        foreign_key_column.column_name,
        foreign_key_column.column_name
      );
    end if;
  end loop;

  for key_row in
    select *
    from (values
      ('public.books'::regclass, 'id'::text),
      ('public.visitors'::regclass, 'id'::text)
    ) as keys(table_name, column_name)
  loop
    select type_info.typname
    into key_type
    from pg_attribute as attribute_info
    join pg_type as type_info
      on type_info.oid = attribute_info.atttypid
    where attribute_info.attrelid = key_row.table_name::oid
      and attribute_info.attname = key_row.column_name
      and not attribute_info.attisdropped;

    if key_type = 'uuid' then
      execute format(
        'alter table %s alter column %I drop default',
        key_row.table_name,
        key_row.column_name
      );
      execute format(
        'alter table %s alter column %I type text using %I::text',
        key_row.table_name,
        key_row.column_name,
        key_row.column_name
      );
    end if;

    if key_row.table_name = 'public.books'::regclass then
      alter table public.books
        alter column id set default (
          'BK-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
        );
    else
      alter table public.visitors
        alter column id set default (
          'VIS-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
        );
    end if;
  end loop;

  for foreign_key_row in
    select * from shelf_legacy_foreign_keys
  loop
    execute format(
      'alter table %s add constraint %I %s%s',
      foreign_key_row.table_name,
      foreign_key_row.constraint_name,
      foreign_key_row.definition,
      case
        when foreign_key_row.is_validated then ''
        else ' not valid'
      end
    );
  end loop;
end;
$$;
