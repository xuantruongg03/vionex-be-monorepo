import {
    Injectable,
    BadRequestException,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { User } from './entities/user.entity';
import { hashPassword } from './common/helper';
import {
    CreateOrganizationDto,
    UpdateOrganizationDto,
    InviteMemberDto,
    UpdateMemberRoleDto,
    OrganizationResponse,
    MemberResponse,
    VerifyOrgEmailDto,
    VerifyOrgEmailResponse,
} from './dto/organization.dto';

@Injectable()
export class OrganizationService {
    constructor(
        @InjectRepository(Organization)
        private organizationRepository: Repository<Organization>,
        @InjectRepository(User)
        private userRepository: Repository<User>,
    ) {}

    async createOrganization(
        ownerId: string,
        createOrgDto: CreateOrganizationDto,
    ): Promise<OrganizationResponse> {
        try {
            // Check if owner exists
            const owner = await this.userRepository.findOne({
                where: { id: ownerId },
            });
            if (!owner) {
                return {
                    message: 'Owner not found',
                    success: false,
                };
            }

            // Check if owner already has an organization
            if (owner.orgId) {
                return {
                    message: 'User already belongs to an organization',
                    success: false,
                };
            }

            // Check if domain is already taken
            const existingOrg = await this.organizationRepository.findOne({
                where: [
                    { name: createOrgDto.name },
                    { domain: createOrgDto.domain },
                ],
            });
            if (existingOrg) {
                return {
                    message: 'Organization name or domain already exists',
                    success: false,
                };
            }

            // Validate domain format (only letters, numbers, hyphens)
            const domainRegex = /^[a-zA-Z0-9-]+$/;
            if (!domainRegex.test(createOrgDto.domain)) {
                return {
                    message:
                        'Domain can only contain letters, numbers, and hyphens',
                    success: false,
                };
            }

            // Create organization
            const organization = this.organizationRepository.create({
                ...createOrgDto,
                ownerId,
            });
            const savedOrg =
                await this.organizationRepository.save(organization);

            // Update owner to be part of organization with owner role
            await this.userRepository.update(ownerId, {
                orgId: savedOrg.id,
                role: 'owner',
            });

            return {
                success: true,
                message: 'Organization created successfully',
                organization: {
                    id: savedOrg.id,
                    name: savedOrg.name,
                    domain: savedOrg.domain,
                    description: savedOrg.description,
                    ownerId: savedOrg.ownerId,
                    memberCount: 1,
                    createdAt: savedOrg.createdAt,
                },
            };
        } catch (error) {
            if (
                error instanceof BadRequestException ||
                error instanceof NotFoundException
            ) {
                throw error;
            }
            throw new BadRequestException('Failed to create organization');
        }
    }

    async getOrganizationInfo(userId: string): Promise<OrganizationResponse> {
        try {
            const user = await this.userRepository.findOne({
                where: { id: userId },
                relations: ['organization'],
            });

            if (!user || !user.organization) {
                return {
                    success: false,
                    message: 'User not found or not part of any organization',
                };
            }

            const memberCount = await this.userRepository.count({
                where: {
                    orgId: user.organization.id,
                    isActive: true,
                    deletedAt: IsNull(),
                },
            });

            return {
                success: true,
                message: 'Organization info retrieved successfully',
                organization: {
                    id: user.organization.id,
                    name: user.organization.name,
                    domain: user.organization.domain,
                    description: user.organization.description,
                    ownerId: user.organization.ownerId,
                    memberCount,
                    createdAt: user.organization.createdAt,
                },
            };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new BadRequestException('Failed to get organization info');
        }
    }

    async updateOrganization(
        userId: string,
        updateOrgDto: UpdateOrganizationDto,
    ): Promise<OrganizationResponse> {
        try {
            const user = await this.userRepository.findOne({
                where: { id: userId },
                relations: ['organization'],
            });

            if (!user || !user.organization) {
                return {
                    success: false,
                    message: 'Organization not found',
                };
            }

            // Only owner can update organization
            if (user.role !== 'owner') {
                throw new ForbiddenException(
                    'Only organization owner can update organization',
                );
            }

            await this.organizationRepository.update(
                user.organization.id,
                updateOrgDto,
            );

            const updatedOrg = await this.organizationRepository.findOne({
                where: { id: user.organization.id },
            });

            if (!updatedOrg) {
                throw new NotFoundException(
                    'Organization not found after update',
                );
            }

            const memberCount = await this.userRepository.count({
                where: {
                    orgId: user.organization.id,
                    isActive: true,
                    deletedAt: IsNull(),
                },
            });

            return {
                success: true,
                message: 'Organization updated successfully',
                organization: {
                    id: updatedOrg.id,
                    name: updatedOrg.name,
                    domain: updatedOrg.domain,
                    description: updatedOrg.description,
                    ownerId: updatedOrg.ownerId,
                    memberCount,
                    createdAt: updatedOrg.createdAt,
                },
            };
        } catch (error) {
            if (
                error instanceof NotFoundException ||
                error instanceof ForbiddenException
            ) {
                throw error;
            }
            throw new BadRequestException('Failed to update organization');
        }
    }

    async inviteMember(
        userId: string,
        inviteDto: InviteMemberDto,
    ): Promise<MemberResponse> {
        try {
            const user = await this.userRepository.findOne({
                where: { id: userId },
                relations: ['organization'],
            });

            if (!user || !user.organization) {
                return {
                    success: false,
                    message: 'User or organization not found',
                };
            }

            // Only organization owner can invite members
            if (user.role !== 'owner') {
                return {
                    success: false,
                    message: 'Only organization owner can invite members',
                };
            }

            // Generate organization email
            const orgEmail = `${inviteDto.name.split('@')[0]}@${user.organization.domain}.vionex`;

            // Check if user with this email already exists
            const existingUser = await this.userRepository.findOne({
                where: { email: orgEmail },
            });
            if (existingUser) {
                return {
                    success: false,
                    message: 'User with this name already exists',
                };
            }

            // Generate temporary password
            const tempPassword = Math.random().toString(36).slice(-8);
            const hashedPassword = await hashPassword(tempPassword);

            // Create new user with member role (INACTIVE - needs activation)
            const newUser = this.userRepository.create({
                email: orgEmail,
                password: hashedPassword, // Temporary password
                name: inviteDto.name,
                orgId: user.organization.id,
                role: 'member', // Always member - only owner exists, all others are members
                isActive: true, // User must activate account by setting their own password
            });

            const savedUser = await this.userRepository.save(newUser);

            return {
                success: true,
                message: `Member invited successfully. Email: ${orgEmail}. User must register with this email to activate account.`,
                member: {
                    id: savedUser.id,
                    email: savedUser.email,
                    name: savedUser.name,
                    role: savedUser.role,
                    password: tempPassword,
                    joinedAt: savedUser.createdAt,
                },
            };
        } catch (error) {
            console.log('error: ', error);
            throw new BadRequestException('Failed to invite member');
        }
    }

    async getMembers(userId: string): Promise<MemberResponse> {
        try {
            const user = await this.userRepository.findOne({
                where: { id: userId },
                relations: ['organization'],
            });

            if (!user || !user.organization) {
                return {
                    success: false,
                    message: 'Organization not found',
                    members: [],
                };
            }

            const members = await this.userRepository.find({
                where: {
                    orgId: user.organization.id,
                    deletedAt: IsNull(),
                },
                select: [
                    'id',
                    'email',
                    'name',
                    'role',
                    'isActive',
                    'createdAt',
                ],
            });

            return {
                success: true,
                message: 'Members retrieved successfully',
                members: members.map((member) => ({
                    id: member.id,
                    email: member.email,
                    name: member.name,
                    role: member.role,
                    isActive: member.isActive,
                    joinedAt: member.createdAt,
                })),
            };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new BadRequestException('Failed to get members');
        }
    }

    async removeMember(
        userId: string,
        memberId: string,
    ): Promise<MemberResponse> {
        try {
            const user = await this.userRepository.findOne({
                where: { id: userId },
                relations: ['organization'],
            });

            if (!user || !user.organization) {
                return {
                    success: false,
                    message: 'Organization not found',
                };
            }

            // Only organization owner can remove members
            if (user.role !== 'owner') {
                return {
                    success: false,
                    message: 'Only organization owner can remove members',
                };
            }

            const memberToRemove = await this.userRepository.findOne({
                where: {
                    id: memberId,
                    orgId: user.organization.id,
                    deletedAt: IsNull(),
                },
            });

            if (!memberToRemove) {
                return {
                    success: false,
                    message: 'Member not found',
                };
            }

            // Cannot remove owner
            if (memberToRemove.role === 'owner') {
                return {
                    success: false,
                    message: 'Cannot remove organization owner',
                };
            }

            // Soft delete member from organization by setting deletedAt
            await this.userRepository.update(memberId, {
                deletedAt: new Date(),
            });

            return {
                success: true,
                message: 'Member removed successfully',
            };
        } catch (error) {
            console.log(error);
            return {
                success: false,
                message: 'Failed to remove member',
            };
        }
    }

    async verifyOrgEmail(
        verifyDto: VerifyOrgEmailDto,
    ): Promise<VerifyOrgEmailResponse> {
        try {
            // Check if email follows organization pattern: xxx@domain.vionex
            const emailParts = verifyDto.email.split('@');
            if (emailParts.length !== 2) {
                return {
                    success: true,
                    message: 'Not an organization email',
                    isOrgEmail: false,
                };
            }

            const [, fullDomain] = emailParts;
            const domainParts = fullDomain.split('.');

            // Check if it's a .vionex domain
            if (domainParts[domainParts.length - 1] !== 'vionex') {
                return {
                    success: true,
                    message: 'Not an organization email',
                    isOrgEmail: false,
                };
            }

            // Extract organization domain (remove .vionex)
            const orgDomain = domainParts.slice(0, -1).join('.');

            // Find organization by domain
            const organization = await this.organizationRepository.findOne({
                where: { domain: orgDomain },
            });

            if (!organization) {
                return {
                    success: true,
                    message: 'Organization not found',
                    isOrgEmail: false,
                };
            }

            return {
                success: true,
                message: 'Organization email verified',
                isOrgEmail: true,
                orgDomain: orgDomain,
                orgId: organization.id,
            };
        } catch (error) {
            return {
                success: false,
                message: 'Failed to verify organization email',
                isOrgEmail: false,
            };
        }
    }
}
