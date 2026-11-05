import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
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

  me: () => apiClient.get<{ user: User }>('/auth/me').then((data) => data.user),

  updateProfile: (input: UpdateProfileInput) =>
    apiClient.patch<{ user: User }>('/auth/me', input).then((data) => data.user),

  changePassword: (input: ChangePasswordInput) =>
    apiClient.post<{ user: User }>('/auth/change-password', input).then((data) => data.user),
};
