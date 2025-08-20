import {
    Controller,
    Post,
    Get,
    Put,
    Delete,
    Body,
    Param,
    UseGuards,
    Request,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
    Injectable,
} from '@nestjs/common';
import { OrganizationClientService } from './clients/organization.client';
import { AuthClientService } from './clients/auth.client';
import { RoomClientService } from './clients/room.client';

// JWT Authentication Guard
@Injectable()
class JwtAuthGuard implements CanActivate {
    constructor(private readonly authClient: AuthClientService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const token = this.extractTokenFromHeader(request);

        if (!token) {
            throw new UnauthorizedException('No token provided');
        }

        try {
            // Verify token with auth service
            const result = await this.authClient.verifyToken(token);

            if (!result.success) {
                throw new UnauthorizedException('Invalid token');
            }

            // Attach user info to request
            request.user = result.user;
            return true;
        } catch (error) {
            console.log(error);

            throw new UnauthorizedException('Token validation failed');
        }
    }

    private extractTokenFromHeader(request: any): string | undefined {
        const [type, token] = request.headers.authorization?.split(' ') ?? [];
        return type === 'Bearer' ? token : undefined;
    }
}

@Controller('api/organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationController {
    constructor(
        private readonly organizationClientService: OrganizationClientService,
        private readonly roomClientService: RoomClientService,
    ) {}

    @Post()
    async createOrganization(
        @Body()
        createOrgDto: {
            name: string;
            domain: string;
            description?: string;
        },
        @Request() req,
    ) {
        const res = await this.organizationClientService.createOrganization({
            ownerId: req.user.id,
            ...createOrgDto,
        });
        return res;
    }

    @Get()
    async getOrganizationInfo(@Request() req) {
        const rs = await this.organizationClientService.getOrganizationInfo({
            userId: req.user.id,
        });
        return {
            data: rs,
        };
    }

    @Put()
    async updateOrganization(
        @Body()
        updateOrgDto: {
            name?: string;
            description?: string;
        },
        @Request() req,
    ) {
        return this.organizationClientService.updateOrganization({
            userId: req.user.id,
            ...updateOrgDto,
        });
    }

    @Post('members/create')
    async inviteMember(
        @Body()
        inviteDto: {
            name: string;
        },
        @Request() req,
    ) {
        const rs = await this.organizationClientService.inviteMember({
            userId: req.user.id,
            ...inviteDto,
        });
        return {
            data: rs,
        };
    }

    @Get('members')
    async getMembers(@Request() req) {
        const rs = await this.organizationClientService.getMembers({
            userId: req.user.id,
        });
        return {
            data: rs,
        };
    }

    @Delete('members/:memberId')
    async removeMember(@Param('memberId') memberId: string, @Request() req) {
        return this.organizationClientService.removeMember({
            userId: req.user.id,
            memberId,
        });
    }

    @Post('verify-email')
    async verifyOrgEmail(@Body() verifyDto: { email: string }) {
        return this.organizationClientService.verifyOrgEmail(verifyDto);
    }

    @Get('rooms')
    async getOrganizationRooms(@Request() req) {
        try {
            // Get organization ID from user context
            const organizationId = req.user.organizationId || req.user.orgId;

            if (!organizationId) {
                return {
                    success: false,
                    message: 'User not associated with any organization',
                    data: [],
                };
            }
            const rs = await this.roomClientService.getOrgRooms({
                userId: req.user.id,
                orgId: organizationId,
            });

            // Map the response to match frontend expectations
            const mappedRooms =
                rs.rooms?.map((room: any) => ({
                    roomId: room.room_id, // Direct room ID (org_xxxx format)
                    roomName: room.name || room.room_id, // Use name or room_id as roomName
                    description: room.description || 'Organization room',
                    isPublic: room.is_public,
                    createdAt: room.created_at,
                    displayId:
                        (room.room_id || room.id)
                            ?.substring(0, 8)
                            ?.toUpperCase() || 'UNKNOWN',
                })) || [];

            return {
                success: true,
                data: mappedRooms,
            };
        } catch (error) {
            console.error('Error getting organization rooms:', error);
            return {
                success: false,
                message: 'Failed to get organization rooms',
                data: [],
            };
        }
    }
}
