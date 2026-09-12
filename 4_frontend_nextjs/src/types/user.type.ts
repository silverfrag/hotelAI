export interface User {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  nationality: string | null;
  role: 'customer' | 'admin';
  account_status: 'Active' | 'Suspended' | 'Deactivated';
  version: number;
}

export interface UserProfile extends User {
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  /** Non-secret marker; authentication is carried by an HttpOnly cookie. */
  accessToken: string;
  user: User;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput extends LoginInput {
  full_name: string;
}
