
var events = require('events');
var _ = require('underscore')._;
_.mixin(require('underscore.string')._);
var fs = require('fs');
var async = require('async');
var path = require('path');
var nimble = require('nimble');
var cproc = require('child_process');
var util = require('util');

var Tree = proto();
Tree.init = function(repo, sha1) {
  this.repo = repo;
  this.sha1 = sha1;
};

Tree.ls = function(cb) {
  var self = this;
  this.repo._lsTree(this.sha1, errorHandler(cb, function(err, data) {
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
  }));
}

Tree.readFile = function(filePath, cb) {
  var self = this;
  var repo = this.repo;
  // Chop off any leading slashes
  filePath = filePath.replace(/^\/+/, '');
  // If the filePath indicates that we're looking into a subfolder
  self.ls(function(err, blobs, trees) {
    if (filePath.match(/\//)) {
      // Load the Tree for the subfolder and recursively call readFile
      var folder = filePath.match(/^[^\/]*/)[0];
      if (!trees[folder]) {
        cb('Could not find folder ' + folder + ' in tree ' + self.sha1);
      } else {
        repo.tree(trees[folder], errorHandler(cb, function(err, tree) {
          tree.readFile(filePath.replace(/^[^\/]*\//, ''), cb);
        }));
      }
    } else {
      // Load the file from its blob
      if (!blobs[filePath]) {
        cb('Could not find file ' + filePath);
      } else {
        repo._readBlob(blobs[filePath], cb);
      }
    }
  });
};

Tree.lsAll = function(cb) {
  var self = this;
  var repo = this.repo;
  var files = {};
  var blobs = {};
  function foundFile(filePath, sha1) {
    files[filePath] = sha1;
    blobs[sha1] = filePath;
  }
  function ls(tree, rootPath, callback) {
    tree.ls(function(err, blobs, trees) {
      _.each(blobs, function(sha1, name) {
        foundFile(path.join(rootPath, name), sha1);
      });
      nimble.each(trees, function(sha1, k, done) {
        repo.tree(sha1, function(err, tree) {
          ls(tree, path.join(rootPath, k), done);
        });
      }, callback);
    });
  }
  ls(self, '', function() {
    cb(null, files, blobs);
  });
};

Tree.checkout = function(rootPath, cb) {
  var self = this;
  var repo = this.repo;
  exec('mkdir', ['-p', rootPath], { cwd: './' }, errorHandler('Error creating directory ' + rootPath, cb, function(err) {
    var resolvedPath = path.resolve(rootPath);
    // we don't really want to do reset --hard because it will mess with the index.
    // it's a bare repo we're checking out to/from, but we get an index, anyway.
    repo.withLock(function(done) {
      repo.gitExec(['--work-tree=' + resolvedPath, 'reset', '--hard', self.sha1], errorHandler(done, done));
    }, cb);
  }));
};

Tree.commit = function(origSha1, msg, changes, cb) {
  var self = this;
  var repo = this.repo;
  repo.withLock(function(doneWithLock) {
    repo.gitExec(['read-tree', origSha1], errorHandler(doneWithLock, function(err) {
      nimble.each(changes, function(data, filePath, done) {
        filePath = filePath.replace(/^\/+/, '');
        repo.gitExec(['hash-object', '-w', '--stdin'], { data: data }, errorHandler(done, function(err, objsha1) {
          repo.gitExec(['update-index', '--add', '--cacheinfo', '100644', _.trim(objsha1), filePath], done);
        }));
      }, function() {
        repo.gitExec(['write-tree'], errorHandler(doneWithLock, function(err, treesha1) {
          repo.gitExec(['commit-tree', _.trim(treesha1), '-p', origSha1], { data: 'commit by gitfs' }, errorHandler(doneWithLock, function(err, commitsha1) {
            doneWithLock(null, repo.tree(_.trim(commitsha1)));
          }));
        }));
      });
    }));
  }, cb);
};

Tree.diff = function(tree2, cb) {
  this.repo.diffTree(this, tree2, cb);
};

exports.Tree = Tree;
