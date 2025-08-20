import { Controller, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { OrganizationService } from './organization.service';
import { GrpcMethod } from '@nestjs/microservices';
import { MemberResponse } from './dto/organization.dto';

@Controller()
export class AuthGrpcController {
    constructor(
        private readonly authService: AuthService,
        private readonly organizationService: OrganizationService,
    ) {}

    @GrpcMethod('AuthService', 'VerifyToken')
    verifyToken(data: { token: string }): Promise<{
        success: boolean;
        message: string;
        user?: {
            id: string;
            email: string;
            name: string;
            avatar: string;
            orgId?: string;
            role?: string;
            organizationId?: string;
        };
    }> {
        return this.authService.verifyToken(data.token);
    }

    @GrpcMethod('AuthService', 'Login')
    login(data: { email: string; password: string }): Promise<{
        success: boolean;
        message: string;
        access_token?: string;
        refresh_token?: string;
    }> {
        return this.authService.login(data);
    }

    @GrpcMethod('AuthService', 'Register')
    register(data: { email: string; password: string; name: string }): Promise<{
        success: boolean;
        message: string;
        access_token?: string;
        refresh_token?: string;
    }> {
        // Check if this is organization email registration
        if (data.email.endsWith('.vionex')) {
            return this.authService.registerOrganizationMember(data);
        }

        return this.authService.register(data);
    }

    @GrpcMethod('AuthService', 'Logout')
    logout(data: { access_token: string }): Promise<{
        success: boolean;
        message: string;
    }> {
        return this.authService.logout(data);
    }

    @GrpcMethod('AuthService', 'GetInfo')
    getInfo(data: { access_token: string }): Promise<{
        success: boolean;
        message: string;
        user?: {
            id: string;
            email: string;
            name: string;
        };
    }> {
        return this.authService.getInfo(data);
    }

    // Organization gRPC methods
    @GrpcMethod('AuthService', 'CreateOrganization')
    createOrganization(data: {
        ownerId: string;
        name: string;
        domain: string;
        description?: string;
    }): Promise<{
        success: boolean;
        message: string;
        organization?: any;
    }> {
        return this.organizationService.createOrganization(data.ownerId, {
            name: data.name,
            domain: data.domain,
            description: data.description,
        });
    }

    @GrpcMethod('AuthService', 'GetOrganizationInfo')
    getOrganizationInfo(data: { userId: string }): Promise<{
        success: boolean;
        message: string;
        organization?: any;
    }> {
        return this.organizationService.getOrganizationInfo(data.userId);
    }

    @GrpcMethod('AuthService', 'UpdateOrganization')
    updateOrganization(data: {
        userId: string;
        name?: string;
        description?: string;
    }): Promise<{
        success: boolean;
        message: string;
        organization?: any;
    }> {
        return this.organizationService.updateOrganization(data.userId, {
            name: data.name,
            description: data.description,
        });
    }

    @GrpcMethod('AuthService', 'InviteMember')
    async inviteMember(data: {
        userId: string;
        name: string;
    }): Promise<MemberResponse> {
        const rs = await this.organizationService.inviteMember(data.userId, {
            name: data.name,
        });

        return {
            success: rs.success,
            message: rs.message,
            member: rs.member,
        };
    }

    @GrpcMethod('AuthService', 'GetMembers')
    getMembers(data: { userId: string }): Promise<{
        success: boolean;
        message: string;
        members?: any[];
    }> {
        return this.organizationService.getMembers(data.userId);
    }

    @GrpcMethod('AuthService', 'RemoveMember')
    removeMember(data: { userId: string; memberId: string }): Promise<{
        success: boolean;
        message: string;
    }> {
        return this.organizationService.removeMember(
            data.userId,
            data.memberId,
        );
    }


    @GrpcMethod('AuthService', 'VerifyOrgEmail')
    verifyOrgEmail(data: { email: string }): Promise<{
        success: boolean;
        message: string;
        isOrgEmail: boolean;
        orgDomain?: string;
        orgId?: string;
    }> {
        return this.organizationService.verifyOrgEmail({ email: data.email });
    }
}
