<p align="center">
  <img src="https://res.cloudinary.com/dcweof28t/image/upload/v1750399380/image_products/favicon_vo2jtz.png" alt="Vionex Logo" width="200"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-e0234e?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"/>
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL"/>
  <img src="https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white" alt="JWT"/>
  <img src="https://img.shields.io/badge/TypeORM-FF6B35?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"/>
</p>

# 🔐 Vionex Auth Service

Authentication and authorization microservice with organization management support for multi-tenant applications.

## ✨ Features

- **User Authentication**: Login, registration, and JWT token management
- **Organization Management**: Multi-tenant organization support
- **Member Management**: Organization member invitation and role management
- **Google OAuth**: Social authentication integration
- **JWT Security**: Access and refresh token handling
- **Role-based Access**: Owner and member role permissions

## 🛠️ Technologies

- **Framework**: NestJS
- **Language**: TypeScript
- **Database**: MySQL
- **ORM**: TypeORM
- **Authentication**: JWT, Passport.js
- **Social Auth**: Google OAuth2
- **Password**: bcrypt

## 📁 Project Structure

```
src/
├── entities/
│   ├── user.entity.ts        # User database model
│   └── organization.entity.ts# Organization database model
├── dto/
│   ├── auth.dto.ts           # Authentication DTOs
│   └── organization.dto.ts   # Organization DTOs
├── auth.controller.ts        # Authentication endpoints
├── auth.service.ts           # Authentication logic
├── organization.controller.ts# Organization endpoints
├── organization.service.ts   # Organization logic
├── auth.module.ts            # Module configuration
└── main.ts                   # Entry point
```

## 🔧 Environment Variables

```bash
# Server
AUTH_GRPC_PORT=30008
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=password
DB_DATABASE=vionex_auth

# JWT
JWT_SECRET=your-jwt-secret-key
JWT_REFRESH_SECRET=your-refresh-secret-key
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
## 📋 Installation

```bash
# Install dependencies
npm install

# Run migrations
npm run migration:run

# Run service
npm run start:dev

# Run with Docker
docker build -t vionex-auth-service .
docker run -p 30008:30008 --env-file .env vionex-auth-service
```
