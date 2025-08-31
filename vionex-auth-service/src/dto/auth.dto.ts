export interface LoginDto {
    email: string;
    password: string;
}

export interface RegisterDto {
    email: string;
    password: string;
    name: string;
}

export interface OrganizationMemberRegisterDto {
    email: string; // Must be @company.vionex format
    password: string;
    name: string;
}

export interface LogoutDto {
    access_token: string;
}

export interface AuthResponse {
    success: boolean;
    message: string;
    access_token?: string;
    refresh_token?: string;
}

export interface GetInfoDto {
    access_token: string;
}

export interface UserInfo {
    success: boolean;
    message: string;
    user?: {
        id: string;
        email: string;
        name: string;
        avatar: string;
        orgId?: string;
        role?: string;
        organization?: {
            id: string;
            name: string;
            domain: string;
        };
    };
}

export interface GoogleAuthDto {
    email: string;
    name: string;
    avatar?: string;
    googleId: string;
}

export interface UpdateProfileDto {
    access_token: string;
    name: string;
    avatar: string;
}

export interface UpdateProfileResponse {
    success: boolean;
    message: string;
    user?: {
        id: string;
        email: string;
        name: string;
        avatar: string;
    };
}
