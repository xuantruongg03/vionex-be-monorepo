import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs/internal/firstValueFrom';
import { Observable } from 'rxjs';

interface OrganizationService {
    createOrganization(data: {
        ownerId: string;
        name: string;
        domain: string;
        description?: string;
    }): Observable<{
        success: boolean;
        message: string;
        organization?: any;
    }>;

    getOrganizationInfo(data: { userId: string }): Observable<{
        success: boolean;
        message: string;
        organization?: any;
    }>;

    updateOrganization(data: {
        userId: string;
        name?: string;
        description?: string;
    }): Observable<{
        success: boolean;
        message: string;
        organization?: any;
    }>;

    inviteMember(data: {
        userId: string;
        name: string;
    }): Observable<{
        success: boolean;
        message: string;
        member?: any;
    }>;

    getMembers(data: { userId: string }): Observable<{
        success: boolean;
        message: string;
        members?: any[];
    }>;

    removeMember(data: { userId: string; memberId: string }): Observable<{
        success: boolean;
        message: string;
    }>;

    verifyOrgEmail(data: { email: string }): Observable<{
        success: boolean;
        message: string;
        isOrgEmail: boolean;
        orgDomain?: string;
        orgId?: string;
    }>;
}

@Injectable()
export class OrganizationClientService implements OnModuleInit {
    private organizationService: OrganizationService;

    constructor(@Inject('AUTH_SERVICE') private client: ClientGrpc) {}

    onModuleInit() {
        this.organizationService =
            this.client.getService<OrganizationService>('AuthService');
    }

    async createOrganization(data: {
        ownerId: string;
        name: string;
        domain: string;
        description?: string;
    }) {
        const response = await firstValueFrom(
            this.organizationService.createOrganization(data),
        );
        return response;
    }

    async getOrganizationInfo(data: { userId: string }) {
        const response = await firstValueFrom(
            this.organizationService.getOrganizationInfo(data),
        );
        return response;
    }

    async updateOrganization(data: {
        userId: string;
        name?: string;
        description?: string;
    }) {
        const response = await firstValueFrom(
            this.organizationService.updateOrganization(data),
        );
        return response;
    }

    async inviteMember(data: { userId: string; name: string }) {
        const response = await firstValueFrom(
            this.organizationService.inviteMember(data),
        );
        return response;
    }

    async getMembers(data: { userId: string }) {
        const response = await firstValueFrom(
            this.organizationService.getMembers(data),
        );
        return response;
    }

    async removeMember(data: { userId: string; memberId: string }) {
        const response = await firstValueFrom(
            this.organizationService.removeMember(data),
        );
        return response;
    }

    async verifyOrgEmail(data: { email: string }) {
        const response = await firstValueFrom(
            this.organizationService.verifyOrgEmail(data),
        );
        return response;
    }
}
