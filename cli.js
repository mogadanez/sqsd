#!/usr/bin/env node
'use strict';

var logger = require('./lib/logger');
var sqsd = require('./lib/index').SQSProcessor;
var program = require('commander');
var _ = require('lodash');



function increaseVerbosity(v, total) {
    return total + 1;
}
var pkg = require('./package.json');

program.version(pkg.version)
    .option('-w, --web-hook [value]', 'The webhook url to which messages from queue be posted. Required' )
    .option('-q, --queue-url [value]', 'Your queue URL. Required')
    .option('--access-key-id [value]', 'Your AWS Access Key. Leave empty if use IAM roles.')
    .option('--secret-access-key [value]', 'Your AWS Secret Access Key. Leave empty if use IAM roles.')
    .option('-r, --region [value]', 'The region name of the AWS SQS queue', "us-east-1")
    .option('-m, --max-messages [value]', 'Max number of messages to retrieve per request.',parseInt, 10)
    .option('-d, --daemonized', 'Whether to continue running with empty queue', false )
    .option('-s, --sleep [value]', 'Number of seconds to wait after polling empty queue when daemonized', parseInt, 0 )
    .option('-t, --timeout [value]', 'Timeout for waiting response from worker, ms', parseInt, 60000 )
    .option('--wait-time [value]', 'Long polling wait time when querying the queue.', parseInt, 20 )
    .option('--content-type [value]', 'Long polling wait time when querying the queue.', 'application/json' )
    .option('--concurrency [value]', 'Long polling wait time when querying the queue.', parseInt,  3  )
    .option('--user-agent [value]', 'User agent',  "sqsd"  )
    .option('-v, --verbose', 'A value that can be increased', increaseVerbosity, 0)


process.argv[1] = 'sqsd';
program.parse(process.argv);

var envParams = { accessKeyId: process.env.AWS_ACCESS_KEY_ID
    , secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    , region: process.env.SQS_QUEUE_REGION_NAME
    , queueUrl: process.env.SQSD_QUEUE_URL
    , maxMessages: process.env.SQSD_MAX_MESSAGES_PER_REQUEST
    , daemonized: process.env.SQSD_RUN_DAEMONIZED
    , sleep: process.env.SQSD_SLEEP_SECONDS
    , waitTime: process.env.SQSD_WAIT_TIME_SECONDS
    , webHook: process.env.SQSD_WORKER_HTTP_URL
    , userAgent: process.env.SQSD_WORKER_USER_AGENT
    , contentType: process.env.SQSD_WORKER_HTTP_REQUEST_CONTENT_TYPE
    , concurrency: process.env.SQSD_WORKER_CONCURRENCY
    , timeout: process.env.SQSD_WORKER_TIMEOUT
    , verbose: 0
}


var mergedParams = _.defaults( _.pick ( program, _.keys(envParams) ), envParams );

if ( ( !mergedParams.queueUrl) || !mergedParams.webHook ) {

    console.log ( "--web-hook  and --queue-url  is required", mergedParams.verbose )
    //program.outputHelp();
    process.exit(1);
}

logger.init( mergedParams.verbose );
logger.info('SQSD v' + pkg.version);
new sqsd(mergedParams).start()
    .catch( err=> {
        logger.error( {err:err}, "Unexpected error")
        process.exit(1);
    })
