
var events = require('events');
var _ = require('underscore')._;
_.mixin(require('underscore.string')._);
var fs = require('fs');
var async = require('async');
var pathjoin = require('path').join;
var nimble = require('nimble');
var cproc = require('child_process');
var util = require('util');

var Tree = proto();
Tree.init = function(repo, sha1) {
  this.repo = repo;
  this.sha1 = sha1;
};

Tree.ls = function(cb) {
  this.repo.gitExec(['ls-tree', this.sha1], function(err, data) {
    var lines = _.trim(data).split('\n');
    var blobs = {};
    var trees = {};
    _.each(lines, function(line) {
      var match = line.match(/^(\d{6}) (\w{4}) ([0-9a-f]{40})\t(.+)$/);
      //var mode = match[1];
      var type = match[2];
      var sha1 = match[3];
      var name = match[4];
      (type === 'blob' ? blobs : trees)[name] = sha1;
    });
    cb(err, blobs, trees);
  });
}

Tree.readFile = function(path, cb) {
  var self = this;
  var repo = this.repo;
  // Chop off any leading slashes
  path = path.replace(/^\/+/, '');
  // If the path indicates that we're looking into a subfolder
  self.ls(function(err, blobs, trees) {
    if (path.match(/\//)) {
      // Load the Tree for the subfolder and recursively call readFile
      var folder = path.match(/^[^\/]*/)[0];
      if (!trees[folder]) {
        cb('Could not find folder ' + folder);
      } else {
        repo.tree(trees[folder], function(err, tree) {
          tree.readFile(path.replace(/^[^\/]*\//, ''), cb);
        });
      }
    } else {
      // Load the file from its blob
      if (!blobs[path]) {
        cb('Could not find file ' + path);
      } else {
        repo._readBlob(blobs[path], cb);
      }
    }
  });
};

function exec3(cmd, args, opts, cb) {
  var simple = _.prune(cmd + ' ' + args.join(' '), 80);
  if (!opts || !opts.cwd) {
    error('cwd not specified in ' + simple);
  }
  var proc = cproc.spawn.call(this, cmd, args, opts),
      out = [],
      err = [],
      t = Timer.make();
  function log(x) {
    process.stdout.write(x + '');
  }
  var lineBuffer = '';
  proc.stdout.on('data', function (data) {
    if (opts.pipe || opts.pipeStdout) { log(data); }
    lineBuffer = lineBuffer + data;
    while (true) {
      var lineMatch = lineBuffer.match(/(.+)\n/);
      if (lineMatch) {
        proc.stdout.emit('line', lineMatch[1]);
        lineBuffer = lineBuffer.replace(/.+\n/, '');
      } else {
        break;
      }
    }
    proc.emit('stdout', data);
    out.push(data);
  });
  proc.stderr.on('data', function (data) {
    if (!opts.quietError) {
      //process.stderr.write(color('    error in ' + simple + ':\n', 'black', true) + color(data + '', 'red'));
      log(data);
    }
    proc.emit('stderr', data);
    err.push(data);
  });
  proc.on('exit', function (code) {
    printFn(t.elapsed() + '  completed2: ' + simple + (code ? ' (' + code + ')' : ''));
    if (cb) {
      cb(code, out.join(''), err.join(''));
    }
    removeLaunchedProcess(proc);
  });
  addLaunchedProcess(proc);
  return proc;
}

Tree.checkout = function(path, cb) {
  var self = this;
  var repo = this.repo;
  // Chop off any leading slashes
  path = path.replace(/^\/+/, '');
  exec('mkdir', ['-p', path], { cwd: './' }, function(err) {
    self.ls(function(err, blobs, trees) {
      async.parallel([
        function(callback) {
          nimble.each(trees, function(sha1, k, done) {
            repo.tree(sha1, function(err, tree) {
              tree.checkout(pathjoin(path, k), done);
            });
          }, callback);
        },
        function(callback) {
          nimble.each(blobs, function(sha1, k, done) {
            var out = fs.createWriteStream(pathjoin(path, k));
            var proc = cproc.spawn('git', ['cat-file', '-p', sha1], { cwd: repo.basePath });
            proc.stdout.pipe(out);
            out.once('close', done);
          }, callback); 
        }
      ], function() {
        cb(null);
      });
    });
  });
};


exports.Tree = Tree;