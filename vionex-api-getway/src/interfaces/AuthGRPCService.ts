import { Observable } from 'rxjs/internal/Observable';

export default interface AuthGRPCService {
    login(data: { email: string; password: string }): Observable<{
        success: boolean;
        access_token?: string;
        refresh_token?: string;
        message?: string;
    }>;

    register(data: {
        name: string;
        password: string;
        email: string;
    }): Observable<{
        success: boolean;
        message?: string;
        access_token?: string;
        refresh_token?: string;
    }>;

    googleAuth(data: {
        email: string;
        name: string;
        avatar?: string;
        googleId: string;
    }): Observable<{
        success: boolean;
        message?: string;
        access_token?: string;
        refresh_token?: string;
    }>;

    logout(data: {
        access_token: string;
    }): Observable<{ success: boolean; message?: string }>;

    getInfo(data: { access_token: string }): Observable<{
        success: boolean;
        message?: string;
        user?: { id: string; email: string; name: string; avatar: string };
    }>;

    verifyToken(data: { token: string }): Observable<{
        success: boolean;
        message?: string;
        user?: { id: string; email: string; name: string; avatar: string };
    }>;

    updateProfile(data: {
        access_token: string;
        name: string;
        avatar: string;
    }): Observable<{
        success: boolean;
        message?: string;
        user?: { id: string; email: string; name: string; avatar: string };
    }>;
}
