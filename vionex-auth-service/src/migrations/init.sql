-- Complete database initialization with Organization support

CREATE DATABASE IF NOT EXISTS `vionex_auth_service` 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE `vionex_auth_service`;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NULL,
    name VARCHAR(255) NULL,
    avatar VARCHAR(500) NULL,
    googleId VARCHAR(255) NULL,
    provider VARCHAR(20) DEFAULT 'local',
    otp VARCHAR(10) NULL,
    isActive BOOLEAN DEFAULT TRUE,
    refreshToken TEXT NULL,
    orgId VARCHAR(36) NULL,
    role VARCHAR(20) DEFAULT 'member',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deletedAt TIMESTAMP NULL DEFAULT NULL
);

-- Create organizations table
CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    domain VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NULL,
    ownerId VARCHAR(36) NOT NULL,
    isActive BOOLEAN DEFAULT TRUE,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Add foreign key constraints
ALTER TABLE organizations 
ADD CONSTRAINT fk_organizations_owner 
FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE users 
ADD CONSTRAINT fk_users_organization
FOREIGN KEY (orgId) REFERENCES organizations(id) ON DELETE SET NULL;

-- Create indexes for better performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_googleId ON users(googleId);
CREATE INDEX idx_users_provider ON users(provider);
CREATE INDEX idx_users_orgId ON users(orgId);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_deletedAt ON users(deletedAt);
CREATE INDEX idx_users_isActive ON users(isActive);
CREATE INDEX idx_organizations_domain ON organizations(domain);
CREATE INDEX idx_organizations_ownerId ON organizations(ownerId);
CREATE INDEX idx_organizations_name ON organizations(name);

-- Create composite indexes for common queries
CREATE INDEX idx_users_org_active_deleted ON users(orgId, isActive, deletedAt);
CREATE INDEX idx_users_role_deleted ON users(role, deletedAt);
