const ROLE_HOME = {
  visitor: '/visitor',
  subadmin: '/subadmin',
  superadmin: '/superadmin',
};

export const getDashboardPath = (role) => ROLE_HOME[role] || '/';
