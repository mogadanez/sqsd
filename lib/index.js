var AWS = require("aws-sdk");
var Promise = require("bluebird");
var logger = require('./logger');
var http = require('http-request');
var httpPOST = Promise.promisify(http.post);

var SQSProcessor = function (options) {
    this.options = options;
    var params = {};
    if (options.queueUrl) {
        params.QueueUrl = options.queueUrl;
        options.queueName = options.queueUrl.substr(options.queueUrl.lastIndexOf("/") + 1)
    }

    else if (options.queueName)
        params.QueueName = options.queueName;

    this._queue = new AWS.SQS({
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        region: options.region,
        params: params
    });
    this.receiveMessage = Promise.promisify (this._queue.receiveMessage, this._queue)
    this.deleteMessage = Promise.promisify (this._queue.deleteMessage, this._queue)

};

SQSProcessor.prototype.postToWorker = function (messageBody, sqsMessage) {
    var headers = {
        'User-Agent': this.options.userAgent,
        'content-type': this.options.contentType,
        'X-Aws-Sqsd-Msgid': sqsMessage.MessageId,
        'X-Aws-Sqsd-Queue': this.options.queueName
    }

    if (sqsMessage.Attributes && sqsMessage.Attributes.ApproximateFirstReceiveTimestamp)
        headers['X-Aws-Sqsd-First-Received-At'] = sqsMessage.Attributes.ApproximateFirstReceiveTimestamp;

    if (sqsMessage.Attributes && sqsMessage.Attributes.ApproximateReceiveCount)
        headers['X-Aws-Sqsd-Receive-Count'] = sqsMessage.Attributes.ApproximateReceiveCount;

    if (sqsMessage.Attributes && sqsMessage.Attributes.SenderId)
        headers['X-Aws-Sqsd-Sender-Id'] = sqsMessage.Attributes.SenderId;


    return httpPOST({
        url: this.options.webHook,
        reqBody: new Buffer(messageBody),
        headers: headers,
        timeout: this.options.timeout
    })

}


SQSProcessor.prototype.handleMessage = function (sqsMessage) {
    var messageBody = sqsMessage.Body;
    var receipt_handle = sqsMessage.ReceiptHandle;

    return this.postToWorker(messageBody, sqsMessage)
        .then(postResult => {
            logger.trace({MessageId: sqsMessage.MessageId, statusCode: postResult.code}, "Received result from worker")
            if ( postResult.code != 200 )
                logger.error({MessageId: sqsMessage.MessageId, statusCode: postResult.code }, "Worker respond  with status != 200  "  )
            if (postResult.code == 200) {
                return this.deleteMessage({
                    ReceiptHandle: receipt_handle
                })
                .then((res)=>{
                    logger.debug({MessageId: sqsMessage.MessageId}, "Message successful removed from sqs ")
                })
            }
        })
        .then(x=> {
            logger.info({MessageId: sqsMessage.MessageId}, "Message successful processed")
        })
        .catch(err=> {
            logger.error("Error while  Message process: "  + err.message )
        })

}


SQSProcessor.prototype.start = function () {
    logger.info("Start Polling Messages")
    return this.receiveMessage({
            MaxNumberOfMessages: this.options.maxMessages,
            WaitTimeSeconds: this.options.waitTime,
            AttributeNames: ["All"],
            MessageAttributeNames: ["All"]
        })
        .then(data => {
            if (!data || !Array.isArray(data.Messages) || data.Messages.length == 0 ) {
                logger.debug("No Messages Received via poll time")
                return;
            }
            logger.info({count: data.Messages.length}, "Messages Received")
            return Promise.map (data.Messages, m => this.handleMessage(m), {concurrency: this.options.concurrency})
        })
        .then(()=> {
            if (this.options.daemonized) {
                return Promise.resolve()
                    .delay(this.options.sleep)
                    .then(()=> this.start())
            }

        })


}


exports.SQSProcessor = SQSProcessor;

