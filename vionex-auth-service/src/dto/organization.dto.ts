export interface CreateOrganizationDto {
    name: string;
    domain: string;
    description?: string;
}

export interface UpdateOrganizationDto {
    name?: string;
    description?: string;
}

export interface InviteMemberDto {
    name: string;
}

export interface UpdateMemberRoleDto {
    userId: string;
    role: 'member'; // Only member role allowed - owner is fixed
}

export interface OrganizationResponse {
    success: boolean;
    message: string;
    organization?: {
        id: string;
        name: string;
        domain: string;
        description?: string;
        ownerId: string;
        memberCount?: number;
        createdAt: Date;
    };
}

export interface MemberResponse {
    success: boolean;
    message: string;
    member?: {
        id: string;
        email: string;
        name: string;
        password?: string;
        role: string;
        joinedAt: Date;
        deletedAt?: Date;
    };
    members?: Array<{
        id: string;
        email: string;
        name: string;
        role: string;
        isActive: boolean;
        joinedAt: Date;
        deletedAt?: Date;
    }>;
}

export interface VerifyOrgEmailDto {
    email: string;
}

export interface VerifyOrgEmailResponse {
    success: boolean;
    message: string;
    isOrgEmail: boolean;
    orgDomain?: string;
    orgId?: string;
}
