var _ = require('lodash');
var bunyan = require('bunyan');

var maxInnerLevel = 2;

function getFullErrorStack(ex, shallowStack, level) {
    var ret = ex.stack || ex.toString();
    if( !shallowStack ) {
        level = level|0;
        if( level < maxInnerLevel && ex.innerError ) {
            ret += '\nCaused by: ' + getFullErrorStack( ex.innerError, false, level + 1 );
        }
        if( level < maxInnerLevel && ex.cause ) {
            ret += '\nCause: ' + getFullErrorStack( ex.cause, false, level + 1 );
        }
    }
    return (ret);
}

function errSerializer(err, shallowStack, level) {
    if (!err) return err;
    level = level|0;
    var obj = {
        message: err.message,
        name: err.name,
        stack: getFullErrorStack(err, shallowStack, level)
    };
    _.defaults(obj, err);
    delete obj.constructor$;
    return obj;
}

var logger = bunyan.createLogger({
    name: "sqsd",
    serializers: _.extend(bunyan.stdSerializers, {
        err: errSerializer

    }),
    streams:[{
            level: "debug",
            stream: process.stdout
        }, {
            level: "error",
            stream: process.stderr
        }]
});


exports.info = logger.info.bind( logger );
exports.debug = logger.debug.bind( logger );
exports.error = logger.error.bind( logger );
exports.warn = logger.warn.bind( logger );
