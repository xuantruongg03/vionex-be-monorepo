import {
    ConflictException,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { decodeToken, generateTokens } from './common/helper';
import {
    AuthResponse,
    GetInfoDto,
    LoginDto,
    LogoutDto,
    RegisterDto,
    UserInfo,
    GoogleAuthDto,
    UpdateProfileDto,
    UpdateProfileResponse,
} from './dto/auth.dto';
import { User } from './entities/user.entity';
import { Organization } from './entities/organization.entity';

@Injectable()
export class AuthService {
    constructor(
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(Organization)
        private organizationRepository: Repository<Organization>,
    ) {}

    async verifyToken(token: string): Promise<{
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
        try {
            const decoded = decodeToken(token);
            if (!decoded) {
                throw new UnauthorizedException('Invalid token');
            }
            const user = await this.userRepository.findOne({
                where: { id: decoded.userId },
                relations: ['organization'],
            });

            if (!user) {
                throw new NotFoundException('User not found');
            }

            return {
                success: true,
                message: 'Token is valid',
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    avatar: user.avatar,
                    orgId: user.orgId, // Get fresh from database
                    role: user.role, // Get fresh from database
                    organizationId: user.orgId, // Add organizationId for compatibility
                },
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Token validation failed',
            };
        }
    }

    async login(data: LoginDto): Promise<AuthResponse> {
        try {
            const { email, password } = data;

            // Find user by email
            const user = await this.userRepository.findOne({
                where: { email, isActive: true },
            });

            if (!user) {
                throw new UnauthorizedException('Invalid credentials');
            }

            // Check password
            const isPasswordValid = await bcrypt.compare(
                password,
                user.password,
            );
            if (!isPasswordValid) {
                throw new UnauthorizedException('Invalid credentials');
            }

            // Generate tokens
            const tokens = await generateTokens(user);

            // Update refresh token in database
            await this.userRepository.update(user.id, {
                refreshToken: tokens.refresh_token,
            });

            return {
                success: true,
                message: 'Login successful',
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Login failed',
            };
        }
    }

    async register(data: RegisterDto): Promise<AuthResponse> {
        try {
            const { email, password, name } = data;

            // BLOCK registration with .vionex emails - these are organization emails only
            if (email.endsWith('.vionex')) {
                throw new ConflictException(
                    'Cannot register with organization email. Organization emails are created by invitation only.',
                );
            }

            // Check if user already exists
            const existingUser = await this.userRepository.findOne({
                where: { email },
            });

            if (existingUser) {
                throw new ConflictException(
                    'User with this email already exists',
                );
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(password, 12);

            // Create new user (regular user, not part of any organization)
            const user = this.userRepository.create({
                email,
                password: hashedPassword,
                name,
                orgId: undefined, // Regular users start without organization
                role: 'member', // Default role
            });

            const savedUser = await this.userRepository.save(user);

            // Generate tokens
            const tokens = await generateTokens(savedUser);

            // Update refresh token in database
            await this.userRepository.update(savedUser.id, {
                refreshToken: tokens.refresh_token,
            });

            return {
                success: true,
                message: 'Registration successful',
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Registration failed',
            };
        }
    }

    /**
     * Special registration method for organization members
     * This is called internally when a member uses their organization email
     * after being invited by the organization owner
     */
    async registerOrganizationMember(data: RegisterDto): Promise<AuthResponse> {
        try {
            const { email, password, name } = data;

            // Verify this is a .vionex email
            if (!email.endsWith('.vionex')) {
                throw new ConflictException(
                    'This method is only for organization email registration',
                );
            }

            // Check if user already exists
            const existingUser = await this.userRepository.findOne({
                where: { email },
            });

            if (!existingUser) {
                throw new NotFoundException(
                    'Organization member account not found. Contact your organization owner.',
                );
            }

            // Check if user is already active (has already set password)
            if (existingUser.isActive && existingUser.password) {
                throw new ConflictException(
                    'Account already activated. Please use login instead.',
                );
            }

            // Hash the new password
            const hashedPassword = await bcrypt.hash(password, 12);

            // Update user with new password and activate account
            await this.userRepository.update(existingUser.id, {
                password: hashedPassword,
                name: name, // Allow user to update their name
                isActive: true,
            });

            // Get updated user
            const updatedUser = await this.userRepository.findOne({
                where: { id: existingUser.id },
            });

            if (!updatedUser) {
                throw new NotFoundException('User not found after update');
            }

            // Generate tokens
            const tokens = await generateTokens(updatedUser);

            // Update refresh token in database
            await this.userRepository.update(existingUser.id, {
                refreshToken: tokens.refresh_token,
            });

            return {
                success: true,
                message: 'Organization member account activated successfully',
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
            };
        } catch (error) {
            return {
                success: false,
                message:
                    error.message || 'Organization member registration failed',
            };
        }
    }

    async logout(
        data: LogoutDto,
    ): Promise<{ success: boolean; message: string }> {
        try {
            const { access_token } = data;
            const decoded = decodeToken(access_token);
            if (!decoded) {
                return {
                    success: false,
                    message: 'Invalid access token',
                };
            }
            const userId = decoded.userId;

            // Clear refresh token
            await this.userRepository.update(userId, {
                refreshToken: undefined,
            });

            return {
                success: true,
                message: 'Logout successful',
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Logout failed',
            };
        }
    }

    async getInfo(data: GetInfoDto): Promise<UserInfo> {
        try {
            const { access_token } = data;
            // Decode token to get user ID
            const decoded = decodeToken(access_token);
            if (!decoded) {
                throw new UnauthorizedException('Invalid access token');
            }
            const userId = decoded.userId;

            // Fetch user information with organization
            const user = await this.userRepository.findOne({
                where: { id: userId },
                relations: ['organization'],
            });

            if (!user) {
                throw new NotFoundException('User not found');
            }

            return {
                success: true,
                message: 'User information retrieved successfully',
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    avatar: user.avatar,
                    orgId: user.orgId,
                    role: user.role,
                    organization: user.organization
                        ? {
                              id: user.organization.id,
                              name: user.organization.name,
                              domain: user.organization.domain,
                          }
                        : undefined,
                },
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Failed to retrieve user information',
            };
        }
    }

    async googleAuth(data: GoogleAuthDto): Promise<AuthResponse> {
        try {
            const { email, name, avatar, googleId } = data;

            // Check if user already exists with this Google ID
            let user = await this.userRepository.findOne({
                where: { googleId },
            });

            // If not found by Google ID, check by email (for existing users)
            if (!user) {
                user = await this.userRepository.findOne({
                    where: { email },
                });

                if (user) {
                    // User exists with this email but different provider
                    // Update user to link Google account
                    await this.userRepository.update(user.id, {
                        googleId,
                        provider: 'google',
                        avatar: avatar || user.avatar, // Update avatar if provided
                        name: name || user.name, // Update name if different
                    });
                } else {
                    // Create new user with Google account
                    user = this.userRepository.create({
                        email,
                        name,
                        avatar,
                        googleId,
                        provider: 'google',
                        // password: undefined, // No password for Google users
                        orgId: undefined, // Regular users start without organization
                        role: 'member', // Default role
                        isActive: true, // Google users are automatically active
                    });

                    user = await this.userRepository.save(user);
                }
            }

            // Generate tokens
            const tokens = await generateTokens(user);

            // Update refresh token in database
            await this.userRepository.update(user.id, {
                refreshToken: tokens.refresh_token,
            });

            return {
                success: true,
                message: 'Google authentication successful',
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Google authentication failed',
            };
        }
    }

    async updateProfile(
        data: UpdateProfileDto,
    ): Promise<UpdateProfileResponse> {
        try {
            const { access_token, name, avatar } = data;

            // Decode token to get user ID
            const decoded = decodeToken(access_token);
            if (!decoded) {
                throw new UnauthorizedException('Invalid access token');
            }
            const userId = decoded.userId;

            // Fetch current user
            const user = await this.userRepository.findOne({
                where: { id: userId },
            });

            if (!user) {
                throw new NotFoundException('User not found');
            }

            // Update user profile
            await this.userRepository.update(userId, {
                name: name.trim(),
                avatar: avatar || user.avatar, // Keep current avatar if not provided
            });

            // Fetch updated user
            const updatedUser = await this.userRepository.findOne({
                where: { id: userId },
            });

            if (!updatedUser) {
                throw new NotFoundException('User not found after update');
            }

            return {
                success: true,
                message: 'Profile updated successfully',
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    name: updatedUser.name,
                    avatar: updatedUser.avatar,
                },
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Profile update failed',
            };
        }
    }
}
