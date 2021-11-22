const AWS = require("aws-sdk");
const debug = require('debug')("sqsd");
const error = require('debug')('sqsd:error');
const _ = require('lodash');
const axios = require("axios")

const delay = time => new Promise(res=>setTimeout(res,time));

function Defer() {
    let resolve, reject;
    const promise = new Promise(function() {
        resolve = arguments[0];
        reject = arguments[1];
    });
    return {
        resolve: resolve,
        reject: reject,
        promise: promise
    };
}

class SQSProcessor {

    constructor(options) {
        this.options = options;
        const params = {};
        if (options.queueUrl) {
            params.QueueUrl = options.queueUrl;
            options.queueName = options.queueUrl.substr(options.queueUrl.lastIndexOf("/") + 1)
        }

        else if (options.queueName)
            params.QueueName = options.queueName;

        const config = {
            accessKeyId: options.accessKeyId,
            secretAccessKey: options.secretAccessKey,
            sessionToken: options.sessionToken,
            region: options.region,
            sslEnabled: options.sslEnabled === 'true'
        };

        if (options.endpointUrl) {
            config.endpoint = options.endpointUrl
            options.queueUrl  = options.endpointUrl + '/' + options.queueName;
            params.QueueName = options.queueName;
        }

        this._queue = new AWS.SQS(config);
        this.processingMesages = [];

    }

    async postToWorker (messageBody, sqsMessage) {
        const headers = {
            'User-Agent': this.options.userAgent,
            'content-type': this.options.contentType,
            'X-Aws-Sqsd-Msgid': sqsMessage.MessageId,
            'X-Aws-Sqsd-Queue': this.options.queueName
        };

        if (sqsMessage.Attributes && sqsMessage.Attributes.ApproximateFirstReceiveTimestamp)
            headers['X-Aws-Sqsd-First-Received-At'] = sqsMessage.Attributes.ApproximateFirstReceiveTimestamp;

        if (sqsMessage.Attributes && sqsMessage.Attributes.ApproximateReceiveCount)
            headers['X-Aws-Sqsd-Receive-Count'] = sqsMessage.Attributes.ApproximateReceiveCount;

        if (sqsMessage.Attributes && sqsMessage.Attributes.SenderId)
            headers['X-Aws-Sqsd-Sender-Id'] = sqsMessage.Attributes.SenderId;

        for(let name in sqsMessage.MessageAttributes) {
            const value = sqsMessage.MessageAttributes[name];
            headers['X-Aws-Sqsd-Attr-'+name] = value.StringValue;
        }

        debug( "WebHook POST %s, %O",  this.options.webHook, headers)

        return axios.post( this.options.webHook,
            Buffer.from(messageBody),
            {
                headers: headers,
                timeout: Number(this.options.timeout) || 0
            }
        )

    }

    handleMessage (sqsMessage) {
        this.processingMesages.push( sqsMessage )
        const messageBody = sqsMessage.Body;
        const receipt_handle = sqsMessage.ReceiptHandle;

        const startTime = new Date().getTime();
        sqsMessage.promise =  this.postToWorker(messageBody, sqsMessage)

        .then( async (postResult) => {
            debug(  "Received result from worker, MessageId: %s  statusCode:%s ", sqsMessage.MessageId, postResult.status)
            if (!(postResult.status < 200 || postResult.status >= 300)) {
                await this._queue.deleteMessage({
                    ReceiptHandle: receipt_handle,
                    QueueUrl: this.options.queueUrl
                }).promise()
                debug("Message successful removed from sqs, %o ", {MessageId: sqsMessage.MessageId, taskTime: new Date().getTime() - startTime})
            } else
                error( "Worker respond  with status != 2XX, MessageId: %s  statusCode:%s ", sqsMessage.MessageId, postResult.status )
        })
        .then(x=> {
            debug( "Message successful processed,  MessageId: %s ", sqsMessage.MessageId)
        })
        .catch(err=> {
            error("Error while  Message process: " + err.message)
        })
        .finally(()=>{
            const index = this.processingMesages.indexOf(sqsMessage);
            if (index > -1) {
                this.processingMesages.splice(index, 1);
            }
            this.scheduleRun();
        })
        return sqsMessage.promise;
    }


    async doCheckWorkerHealth (beginTimeStamp) {

        debug("try ping worker by " + this.options.workerHealthUrl)

        try {
            await axios.get(this.options.workerHealthUrl)
            debug("Worker is health.")
            return true
        }
        catch(e){
            error("Check worker failed" + e.message)
            if ((beginTimeStamp + this.options.workerHealthWaitTime) < new Date().getTime())
                return false;
            await delay(1000)
            return this.doCheckWorkerHealth(beginTimeStamp)

        }
    }

    async checkWorkerHealth () {
        if (this.healthChecked) //cached result, no sense to check worker on each cycle
            return this.healthChecked;
        if (!this.options.workerHealthUrl)
            return true
        debug("Check worker for health")
        this.healthChecked = await this.doCheckWorkerHealth(new Date().getTime())
        return this.healthChecked
    }


    async tick  () {
        if (  this.polling || this.processingMesages.length >=  this.options.maxMessages ) {
            return
        }

        debug("Start Polling For %s Messages", (this.options.maxMessages - this.processingMesages.length))
        this.polling = true;
        let data = await this._queue.receiveMessage({
            MaxNumberOfMessages: this.options.maxMessages - this.processingMesages.length,
            WaitTimeSeconds: this.options.waitTime,
            AttributeNames: ["All"],
            MessageAttributeNames: ["All"],
            QueueUrl: this.options.queueUrl
        }).promise();

        if ( data && Array.isArray(data.Messages) && data.Messages.length >0 ) {
            debug( "Messages Received: %s ", data.Messages.length )
            data.Messages.forEach( m => {
                this.handleMessage(m);
            })
        }
        else
            debug("No Messages Received via poll time")

        this.polling = false;
        return this.scheduleRun();
    }



    scheduleRun  () {
        if (this.options.daemonized) {
            this.tick()
            .catch((e)=> {
                this.deferredStop.reject(e);
            })
        }
        else{
            debug("not a daemon, wait and exit")
            return this.waitForFinish()
        }
    }

    waitForFinish  () {
        debug("Wait for rest messages")
        return Promise.all(  this.processingMesages.map( x => x.promise ) )
    }


    async start () {
        let health = await  this.checkWorkerHealth()
        if (!health) {
            debug("Worker not responding, cannot continue")
            return;
        }
        if (this.options.sleep) {
            this._tick = this.tick;
            this.tick = _.throttle(this._tick.bind(this), this.options.sleep)
        }
        if (this.options.daemonized) {
            this.deferredStop = new Defer();//used to to stop if error happens, should works infinite in OK scenario
            await this.scheduleRun();
            return this.deferredStop.promise;
        }
        else
            return this.tick()

    }


}


exports.SQSProcessor = SQSProcessor;
