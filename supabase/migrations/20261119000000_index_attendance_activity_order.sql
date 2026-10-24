CREATE INDEX IF NOT EXISTS attendance_logs_time_in_id_idx
  ON public.attendance_logs (time_in DESC, id ASC);

CREATE INDEX IF NOT EXISTS attendance_logs_visitor_time_id_idx
  ON public.attendance_logs (visitor_id, time_in DESC, id ASC);

CREATE INDEX IF NOT EXISTS attendance_logs_library_time_id_idx
  ON public.attendance_logs (library_id, time_in DESC, id ASC);
