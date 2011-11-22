
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
            // Note: this will spawn a LOT of processes really fast if
            // checking out a reasonably large repo.  We should use an
            // assembly line type pattern where we recursively traverse
            // the tree aggressively but add anything found there to a
            // concurrency-limited queue to actually read the blobs.
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

Tree.commit = function(origSha1, msg, changes, cb) {
  // TODO: We need to lock this repo or something.
  // Sure, git locks it, but we don't want to just fail,
  // we'd like to be optimal.
  // Of course, maybe we really want to bypass all this
  // 'checkout' crap anyway.
  var self = this;
  var repo = this.repo;
  repo.gitExec(['checkout', '-q', origSha1], function(err) {
    nimble.each(changes, function(data, path, done) {
      path = path.replace(/^\/+/, '');
      fs.writeFile(pathjoin(repo.basePath, path), data, function(err) {
        repo.gitExec(['add', path], function(err, data) {
          done();
        });
      });
    }, function() {
      repo.gitExec(['commit', '-m', msg], function(err, data) {
        repo._revParse('HEAD', function(err, newSha1) {
          cb(null, repo.tree(newSha1));
        });
      });
    });
  });
};


exports.Tree = Tree;