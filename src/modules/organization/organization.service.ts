import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Organization as OrganizationModel,
  OrganizationDocument,
  IOrganizationSecuritySettings,
} from '../../schemas/team-project/organization.schema';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

export interface OrganizationSecuritySettings {
  killSwitchActive?: boolean;
  readOnlyMode?: boolean;
  requireMfaForSensitiveActions?: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  securitySettings?: OrganizationSecuritySettings;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class OrganizationService {
  constructor(
    @InjectModel(OrganizationModel.name)
    private readonly organizationModel: Model<OrganizationDocument>,
  ) {}

  async list(
    ownerId: string,
    limit = 50,
    offset = 0,
  ): Promise<{
    organizations: Organization[];
    total: number;
  }> {
    const query = { ownerId: new Types.ObjectId(ownerId), isActive: true };
    const [organizations, total] = await Promise.all([
      this.organizationModel
        .find(query)
        .select(
          'name slug ownerId securitySettings isActive createdAt updatedAt',
        )
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean()
        .exec(),
      this.organizationModel.countDocuments(query),
    ]);

    return {
      organizations: organizations.map((doc) => this.toOrganization(doc)),
      total,
    };
  }

  async getOrganizationById(
    organizationId: string,
  ): Promise<Organization | null> {
    if (!organizationId || !Types.ObjectId.isValid(organizationId)) {
      return null;
    }

    const doc = await this.organizationModel
      .findById(organizationId)
      .select('name slug ownerId securitySettings isActive createdAt updatedAt')
      .lean()
      .exec();

    if (!doc || doc.isActive === false) {
      return null;
    }

    return this.toOrganization(doc);
  }

  async create(
    ownerId: string,
    dto: CreateOrganizationDto,
  ): Promise<Organization> {
    const slug = dto.slug.toLowerCase().trim();
    const existing = await this.organizationModel
      .findOne({ slug, isActive: true })
      .exec();
    if (existing) {
      throw new ConflictException(
        `Organization with slug "${slug}" already exists`,
      );
    }

    const doc = await this.organizationModel.create({
      name: dto.name.trim(),
      slug,
      ownerId: new Types.ObjectId(ownerId),
      securitySettings: dto.securitySettings ?? {},
      isActive: true,
    });

    return this.toOrganization(doc.toObject());
  }

  async update(
    organizationId: string,
    userId: string,
    dto: UpdateOrganizationDto,
  ): Promise<Organization> {
    const doc = await this.organizationModel.findById(organizationId).exec();
    if (!doc) {
      throw new NotFoundException('Organization not found');
    }
    if (doc.ownerId.toString() !== userId) {
      throw new ForbiddenException(
        'Only the owner can update this organization',
      );
    }

    if (dto.name !== undefined) doc.name = dto.name.trim();
    if (dto.slug !== undefined) {
      const slug = dto.slug.toLowerCase().trim();
      const existing = await this.organizationModel
        .findOne({ slug, _id: { $ne: organizationId }, isActive: true })
        .exec();
      if (existing) {
        throw new ConflictException(
          `Organization with slug "${slug}" already exists`,
        );
      }
      doc.slug = slug;
    }
    if (dto.securitySettings !== undefined) {
      doc.securitySettings = {
        ...doc.securitySettings,
        ...dto.securitySettings,
      };
    }
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    doc.updatedAt = new Date();
    await doc.save();

    return this.toOrganization(doc.toObject());
  }

  async delete(organizationId: string, userId: string): Promise<void> {
    const doc = await this.organizationModel.findById(organizationId).exec();
    if (!doc) {
      throw new NotFoundException('Organization not found');
    }
    if (doc.ownerId.toString() !== userId) {
      throw new ForbiddenException(
        'Only the owner can delete this organization',
      );
    }

    doc.isActive = false;
    doc.updatedAt = new Date();
    await doc.save();
  }

  private toOrganization(doc: {
    _id: Types.ObjectId;
    name: string;
    slug: string;
    ownerId: Types.ObjectId;
    securitySettings?: IOrganizationSecuritySettings;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): Organization {
    return {
      id: String(doc._id),
      name: doc.name,
      slug: doc.slug,
      ownerId: String(doc.ownerId),
      securitySettings: doc.securitySettings
        ? this.mapSecuritySettings(doc.securitySettings)
        : undefined,
      isActive: doc.isActive,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  private mapSecuritySettings(
    settings: IOrganizationSecuritySettings,
  ): OrganizationSecuritySettings {
    return {
      killSwitchActive: settings?.killSwitchActive,
      readOnlyMode: settings?.readOnlyMode,
      requireMfaForSensitiveActions: settings?.requireMfaForSensitiveActions,
    };
  }
}
