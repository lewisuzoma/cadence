import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  UpdateProfileInput,
  User,
} from '@cadence/shared';
import { apiClient } from '@/lib/api-client';

/** Every auth call the client makes. Thin by design: no logic lives here. */
export const authApi = {
  register: (input: RegisterInput) =>
    apiClient.post<{ user: User }>('/auth/register', input).then((data) => data.user),

  login: (input: LoginInput) =>
    apiClient.post<{ user: User }>('/auth/login', input).then((data) => data.user),

  logout: () => apiClient.post<{ success: boolean }>('/auth/logout'),

  /**
   * Resolves whether or not the address is registered — the server will not
   * say, so there is nothing here to branch on.
   */
  forgotPassword: (input: ForgotPasswordInput) =>
    apiClient.post<{ success: boolean }>('/auth/forgot-password', input),

  resetPassword: (input: ResetPasswordInput) =>
    apiClient.post<{ success: boolean }>('/auth/reset-password', input),

  me: () => apiClient.get<{ user: User }>('/auth/me').then((data) => data.user),

  updateProfile: (input: UpdateProfileInput) =>
    apiClient.patch<{ user: User }>('/auth/me', input).then((data) => data.user),

  changePassword: (input: ChangePasswordInput) =>
    apiClient.post<{ user: User }>('/auth/change-password', input).then((data) => data.user),
};
