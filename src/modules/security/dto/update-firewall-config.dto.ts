import { IsOptional, IsBoolean, IsNumber, Min, Max } from 'class-validator';

export class UpdateFirewallConfigDto {
  @IsOptional()
  @IsBoolean()
  enableBasicFirewall?: boolean;

  @IsOptional()
  @IsBoolean()
  enableAdvancedFirewall?: boolean;

  @IsOptional()
  @IsBoolean()
  enableRAGSecurity?: boolean;

  @IsOptional()
  @IsBoolean()
  enableToolSecurity?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  promptGuardThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  openaiSafeguardThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  ragSecurityThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  toolSecurityThreshold?: number;

  @IsOptional()
  @IsBoolean()
  sandboxHighRisk?: boolean;

  @IsOptional()
  @IsBoolean()
  requireHumanApproval?: boolean;
}
