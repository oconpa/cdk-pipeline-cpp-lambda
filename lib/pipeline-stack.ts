import * as cdk from '@aws-cdk/core';
import * as codecommit from '@aws-cdk/aws-codecommit';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';
import * as s3 from '@aws-cdk/aws-s3';
import * as lambda from '@aws-cdk/aws-lambda';
import * as apigw from '@aws-cdk/aws-apigateway';
import * as iam from '@aws-cdk/aws-iam';

export class PipelineStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'C++ Bucket');

    const func = new lambda.Function(this, 'MyFunction', {
      runtime: lambda.Runtime.PROVIDED,
      handler: 's3Read',
      code: lambda.Code.fromAsset('./lambda/s3Read.zip'),
      environment: {
        'Bucket': bucket.bucketName
      }
    });
    bucket.grantReadWrite(func);

    new apigw.LambdaRestApi(this, 'Endpoint', {
      handler: func
    });
    
    const repository = new codecommit.Repository(this, 'CppOnLambdaRepo', {
      repositoryName: "CppOnLambdaRepo",
      description: 'Where you will store your CDK for C++ Lambda'
    });
    const project = new codebuild.PipelineProject(this, 'CppOnLambda', {
      projectName: 'CppOnLambda',
      cache: codebuild.Cache.bucket(new s3.Bucket(this, 'Bucket')),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'echo Entered the install phase...',
              'yum install -y cmake3',
              'cmake3 --version'
            ]
          },
          build: {
            commands: [
              'echo Entered the build phase...',
              'mkdir build && cd build',
              'cmake3 .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH=out',
              'make',
              'make aws-lambda-package-s3Read'
            ]
          },
          post_build: {
            commands: [
              'echo Publishing code at `date`',
              'aws lambda update-function-code --function-name ' + func.functionName + ' --zip-file fileb://s3Read.zip'
            ]
          }
        }
      })
    })
    project.addToRolePolicy(new iam.PolicyStatement({
      resources: [func.functionArn],
      actions: ['lambda:UpdateFunctionCode']
    }));

    const sourceOutput = new codepipeline.Artifact();
    const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName: 'CodeCommit',
      repository,
      output: sourceOutput,
    });
    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuild',
      project,
      input: sourceOutput
    });

    new codepipeline.Pipeline(this, 'MyPipeline', {
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'Build',
          actions: [buildAction],
        }
      ],
    });
        
  }
}
