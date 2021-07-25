import boto3
import os

s3 = boto3.resource('s3', region_name="ap-southeast-1")

bucket = os.environ['DATA_BUCKET']
output_key = os.environ['OUTPUT_KEY']

some_binary_data = b'Here we have some data'
object = s3.Object(bucket, output_key)
object.put(Body=some_binary_data)

