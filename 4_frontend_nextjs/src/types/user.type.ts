export interface User {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

export interface AuthSession {
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
