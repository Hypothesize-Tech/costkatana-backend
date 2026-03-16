import {
  IsOptional,
  IsString,
  IsBoolean,
  IsEnum,
  IsInt,
  Min,
  IsMongoId,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UserManagementFiltersDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(['user', 'admin'])
  role?: 'user' | 'admin';

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  emailVerified?: boolean;

  @IsOptional()
  @IsEnum(['free', 'pro', 'enterprise', 'plus'])
  subscriptionPlan?: 'free' | 'pro' | 'enterprise' | 'plus';

  @IsOptional()
  @IsEnum(['name', 'email', 'createdAt', 'lastLogin', 'totalCost'])
  sortBy?: 'name' | 'email' | 'createdAt' | 'lastLogin' | 'totalCost';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => parseInt(value))
  offset?: number;
}

export class UpdateUserStatusDto {
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive: boolean;
}

export class UpdateUserRoleDto {
  @IsEnum(['user', 'admin'])
  role: 'user' | 'admin';
}

export class UserDetailParamsDto {
  @IsMongoId()
  userId: string;
}

export class UserManagementStatsDto {}
