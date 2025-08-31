import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    DeleteDateColumn,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { Organization } from './organization.entity';

@Entity('users')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    email: string;

    @Column({ nullable: true })
    password: string;

    @Column({ nullable: true })
    name: string;

    @Column({ nullable: true })
    avatar: string;

    @Column({ nullable: true })
    googleId: string;

    @Column({ default: 'local' })
    provider: string; // 'local' | 'google'

    @Column({ nullable: true })
    otp: string;

    @Column({ default: true })
    isActive: boolean;

    @Column({ nullable: true, type: 'text' })
    refreshToken: string;

    @Column({ nullable: true })
    orgId: string;

    @Column({ default: 'member' })
    role: string; // 'owner' | 'admin' | 'member'

    @ManyToOne(() => Organization, (org) => org.members)
    @JoinColumn({ name: 'orgId' })
    organization: Organization;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @DeleteDateColumn()
    deletedAt: Date;
}
