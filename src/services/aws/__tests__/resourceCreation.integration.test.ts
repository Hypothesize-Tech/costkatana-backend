/**
 * AWS Resource Creation Integration Tests
 * 
 * Tests for all resource creation operations across EC2, RDS, Lambda, DynamoDB, ECS, and S3
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { resourceCreationPlanGeneratorService } from '../resourceCreationPlanGenerator.service';
import { defaultResourceConfigService } from '../defaultResourceConfig.service';
import { ec2ServiceProvider } from '../providers/ec2.service';
import { rdsServiceProvider } from '../providers/rds.service';
import { lambdaServiceProvider } from '../providers/lambda.service';
import { dynamodbServiceProvider } from '../providers/dynamodb.service';
import { ecsServiceProvider } from '../providers/ecs.service';
import { s3ServiceProvider } from '../providers/s3.service';
import { IAWSConnection } from '../../../models/AWSConnection';

// Mock connection for testing
const mockConnection: IAWSConnection = {
  _id: { toString: () => 'test-connection-id' } as any,
  userId: { toString: () => 'test-user-id' } as any,
  connectionName: 'Test Connection',
  environment: 'development',
  awsAccountId: '123456789012',
  roleArn: 'arn:aws:iam::123456789012:role/CostKatanaRole',
  externalId: 'test-external-id',
  externalIdHash: 'test-hash',
  permissionMode: 'read-write',
  allowedRegions: ['us-east-1'],
  allowedServices: [
    { service: 'ec2', actions: ['ec2:*'] },
    { service: 's3', actions: ['s3:*'] },
    { service: 'rds', actions: ['rds:*'] },
    { service: 'lambda', actions: ['lambda:*'] },
    { service: 'dynamodb', actions: ['dynamodb:*'] },
    { service: 'ecs', actions: ['ecs:*'] },
  ],
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
} as any;

describe('AWS Resource Creation Integration Tests', () => {
  describe('Plan Generation', () => {
    it('should generate EC2 creation plan with cost estimates', async () => {
      const plan = await resourceCreationPlanGeneratorService.generateEC2Plan(mockConnection, {
        instanceName: 'test-instance',
        instanceType: 't3.micro',
        region: 'us-east-1',
      });

      expect(plan).toBeDefined();
      expect(plan.resourceType).toBe('ec2');
      expect(plan.resourceName).toBe('test-instance');
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.costEstimate.monthly).toBeGreaterThan(0);
      expect(plan.costEstimate.freeEligible).toBe(true);
      expect(plan.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should generate RDS creation plan with warnings', async () => {
      const plan = await resourceCreationPlanGeneratorService.generateRDSPlan(mockConnection, {
        dbInstanceIdentifier: 'test-db',
        engine: 'postgres',
        dbInstanceClass: 'db.t3.micro',
        allocatedStorage: 20,
        region: 'us-east-1',
      });

      expect(plan).toBeDefined();
      expect(plan.resourceType).toBe('rds');
      expect(plan.warnings.length).toBeGreaterThan(0);
      expect(plan.costEstimate.monthly).toBeGreaterThan(0);
      expect(plan.riskLevel).toBe('high');
    });

    it('should generate Lambda creation plan', async () => {
      const plan = await resourceCreationPlanGeneratorService.generateLambdaPlan(mockConnection, {
        functionName: 'test-function',
        runtime: 'nodejs20.x',
        region: 'us-east-1',
      });

      expect(plan).toBeDefined();
      expect(plan.resourceType).toBe('lambda');
      expect(plan.costEstimate.freeEligible).toBe(true);
      expect(plan.riskLevel).toBe('low');
    });

    it('should generate DynamoDB creation plan', async () => {
      const plan = await resourceCreationPlanGeneratorService.generateDynamoDBPlan(mockConnection, {
        tableName: 'test-table',
        partitionKeyName: 'id',
        partitionKeyType: 'S',
        billingMode: 'PAY_PER_REQUEST',
        region: 'us-east-1',
      });

      expect(plan).toBeDefined();
      expect(plan.resourceType).toBe('dynamodb');
      expect(plan.costEstimate.freeEligible).toBe(true);
    });

    it('should generate ECS creation plan', async () => {
      const plan = await resourceCreationPlanGeneratorService.generateECSPlan(mockConnection, {
        clusterName: 'test-cluster',
        region: 'us-east-1',
      });

      expect(plan).toBeDefined();
      expect(plan.resourceType).toBe('ecs');
      expect(plan.costEstimate.monthly).toBe(0); // Cluster is free
    });

    it('should generate S3 creation plan', async () => {
      const plan = await resourceCreationPlanGeneratorService.generateS3Plan(mockConnection, {
        bucketName: 'test-bucket-unique-123',
        region: 'us-east-1',
      });

      expect(plan).toBeDefined();
      expect(plan.resourceType).toBe('s3');
      expect(plan.costEstimate.freeEligible).toBe(true);
    });
  });

  describe('Parameter Validation', () => {
    it('should reject EC2 creation without instance name', async () => {
      await expect(
        resourceCreationPlanGeneratorService.generateEC2Plan(mockConnection, {
          instanceName: '',
          region: 'us-east-1',
        })
      ).rejects.toThrow();
    });

    it('should reject RDS creation without identifier', async () => {
      await expect(
        resourceCreationPlanGeneratorService.generateRDSPlan(mockConnection, {
          dbInstanceIdentifier: '',
          engine: 'postgres',
          region: 'us-east-1',
        })
      ).rejects.toThrow();
    });

    it('should reject Lambda creation without function name', async () => {
      await expect(
        resourceCreationPlanGeneratorService.generateLambdaPlan(mockConnection, {
          functionName: '',
          region: 'us-east-1',
        })
      ).rejects.toThrow();
    });

    it('should reject DynamoDB creation without table name', async () => {
      await expect(
        resourceCreationPlanGeneratorService.generateDynamoDBPlan(mockConnection, {
          tableName: '',
          partitionKeyName: 'id',
          region: 'us-east-1',
        })
      ).rejects.toThrow();
    });

    it('should reject ECS creation without cluster name', async () => {
      await expect(
        resourceCreationPlanGeneratorService.generateECSPlan(mockConnection, {
          clusterName: '',
          region: 'us-east-1',
        })
      ).rejects.toThrow();
    });
  });

  describe('Cost Estimation', () => {
    it('should estimate EC2 t3.micro as free tier eligible', async () => {
      const plan = await resourceCreationPlanGeneratorService.generateEC2Plan(mockConnection, {
        instanceName: 'test',
        instanceType: 't3.micro',
        region: 'us-east-1',
      });

      expect(plan.costEstimate.freeEligible).toBe(true);
    });

    it('should estimate RDS db.t3.micro as free tier eligible', async () => {
      const plan = await resourceCreationPlanGeneratorService.generateRDSPlan(mockConnection, {
        dbInstanceIdentifier: 'test',
        engine: 'postgres',
        dbInstanceClass: 'db.t3.micro',
        region: 'us-east-1',
      });

      expect(plan.costEstimate.freeEligible).toBe(true);
    });

    it('should estimate Lambda as free tier eligible', async () => {
      const plan = await resourceCreationPlanGeneratorService.generateLambdaPlan(mockConnection, {
        functionName: 'test',
        region: 'us-east-1',
      });

      expect(plan.costEstimate.freeEligible).toBe(true);
      expect(plan.costEstimate.monthly).toBeLessThan(1);
    });

    it('should estimate DynamoDB as free tier eligible', async () => {
      const plan = await resourceCreationPlanGeneratorService.generateDynamoDBPlan(mockConnection, {
        tableName: 'test',
        partitionKeyName: 'id',
        region: 'us-east-1',
      });

      expect(plan.costEstimate.freeEligible).toBe(true);
    });

    it('should estimate ECS cluster as free', async () => {
      const plan = await resourceCreationPlanGeneratorService.generateECSPlan(mockConnection, {
        clusterName: 'test',
        region: 'us-east-1',
      });

      expect(plan.costEstimate.monthly).toBe(0);
    });
  });

  describe('Plan Expiration', () => {
    it('should set plan expiration to 15 minutes', async () => {
      const plan = await resourceCreationPlanGeneratorService.generateEC2Plan(mockConnection, {
        instanceName: 'test',
        region: 'us-east-1',
      });

      const expirationTime = plan.expiresAt.getTime() - plan.createdAt.getTime();
      const fifteenMinutes = 15 * 60 * 1000;

      expect(expirationTime).toBeLessThanOrEqual(fifteenMinutes);
      expect(expirationTime).toBeGreaterThan(fifteenMinutes - 1000); // Allow 1 second variance
    });
  });

  describe('Default Resource Configuration', () => {
    it('should retrieve or create default resources', async () => {
      const config = await defaultResourceConfigService.getDefaultConfig(mockConnection, 'us-east-1');

      expect(config).toBeDefined();
      expect(config.region).toBe('us-east-1');
      expect(config.vpcId).toBeDefined();
      expect(config.subnetIds).toBeDefined();
      expect(config.subnetIds!.length).toBeGreaterThan(0);
      expect(config.securityGroupId).toBeDefined();
    });

    it('should cache default resources', async () => {
      const config1 = await defaultResourceConfigService.getDefaultConfig(mockConnection, 'us-east-1');
      const config2 = await defaultResourceConfigService.getDefaultConfig(mockConnection, 'us-east-1');

      expect(config1.vpcId).toBe(config2.vpcId);
      expect(config1.securityGroupId).toBe(config2.securityGroupId);
    });
  });
});
