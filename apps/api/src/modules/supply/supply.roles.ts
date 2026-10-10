// Who may do what with supply data. Shared by the property and file controllers.
export const READ = ['manager_admin', 'manager_staff', 'landlord', 'agent'] as const;
export const WRITE = READ;                                       // anyone in the organisation who manages supply
export const ARCHIVE = ['manager_admin', 'landlord'] as const;   // removing things is for owners and administrators
