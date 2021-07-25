import * as cdk from '@aws-cdk/core';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as s3 from '@aws-cdk/aws-s3';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ec2 from '@aws-cdk/aws-ec2'; 
import * as lambda from '@aws-cdk/aws-lambda';
import * as batch from '@aws-cdk/aws-batch'; 
import * as iam from '@aws-cdk/aws-iam'; 
import * as eventsources from '@aws-cdk/aws-lambda-event-sources';
import parameters from "../parameters.json";

export class OpsStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'TheVPC', {
      cidr: "10.0.0.0/16"
    })

    const bucket = new s3.Bucket(this, 'bioinfomatics-sequencing-data', {
      bucketName: parameters.artifactBucket
    });

    const jobRole = new iam.Role(this, 'JobRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    
    jobRole.addToPolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: ['s3:*'],
    }));

    jobRole.addToPolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: ["sts:AssumeRole"],
    }));

    const awsManagedEnvironment = new batch.ComputeEnvironment(this, 'AWS-Managed-Compute-Env', {
      computeResources: {
        vpc: vpc,
        instanceTypes: [
          ec2.InstanceType.of(ec2.InstanceClass.M6G, ec2.InstanceSize.LARGE),
          ec2.InstanceType.of(ec2.InstanceClass.M6G, ec2.InstanceSize.XLARGE4),
          ec2.InstanceType.of(ec2.InstanceClass.M6G, ec2.InstanceSize.XLARGE8),
          ec2.InstanceType.of(ec2.InstanceClass.M6G, ec2.InstanceSize.XLARGE16)
        ]
      },
      // serviceRole: jobRole
    });
    
    const jobDefinition = new batch.JobDefinition(this, 'batch-job-def-from-local', {
      container: {
        image: ecs.ContainerImage.fromAsset('./job'),
        memoryLimitMiB: parameters.jobMemoryLimit,
        vcpus: parameters.jobCpuLimit,
        jobRole: jobRole
      },
    });

    const jobQueue = new batch.JobQueue(this, 'JobQueue', {
      computeEnvironments: [
        {
          // Defines a collection of compute resources to handle assigned batch jobs
          computeEnvironment: awsManagedEnvironment,
          // Order determines the allocation order for jobs (i.e. Lower means higher preference for job assignment)
          order: 1,
        },
      ],
    });

    const lambdaRole = new iam.Role(this, 'LamdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
    });

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: ['batch:*'],
    }));

    const lambdaFn = new lambda.Function(this, 'BatchS3Trigger', {
      code: lambda.Code.fromAsset("./lambda"),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_14_X,
      functionName: 'BatchS3Trigger',
      environment: {
        JOB_DEFINITION: jobDefinition.jobDefinitionArn,
        JOB_NAME: "testFromLambda",
        JOB_QUEUE: jobQueue.jobQueueArn
      },
      role: lambdaRole
    });
  
    lambdaFn.addEventSource(new eventsources.S3EventSource(bucket, {
      events: [s3.EventType.OBJECT_CREATED],
      filters: [{
        prefix: 'input'
      }]
    }))
        
    const gitHubSource = codebuild.Source.gitHub({
      owner: 'thangufo',
      repo: 'aws-ci-cd-serverless-api',
      // webhook: true,
      // webhookFilters: [
      //   codebuild.FilterGroup
      //     .inEventOf(codebuild.EventAction.PUSH)
      // ],
    });

    new codebuild.Project(this, 'python-app', {
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yaml'),
      source: gitHubSource,
      projectName: 'python-app',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_5_0
      }, 
    });
  }
}
