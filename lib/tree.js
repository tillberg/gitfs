
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
  function foundFile(filePath, sha1) {
    files[filePath] = sha1;
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
    cb(null, files);
  });
};

Tree.checkout = function(rootPath, cb) {
  var self = this;
  var repo = this.repo;
  exec('mkdir', ['-p', rootPath], { cwd: './' }, errorHandler('Error creating directory ' + rootPath, cb, function(err) {
    var resolvedPath = path.resolve(rootPath);
    // we don't really want to do reset --hard because it will mess with the index.
    // it's a bare repo we're checking out to/from, but we get an index, anyway.
    repo.gitExec(['--work-tree=' + resolvedPath, 'reset', '--hard', self.sha1], errorHandler('Error checking out ' + self.sha1 + ' to ' + resolvedPath, cb, cb));
  }));
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
    nimble.each(changes, function(data, filePath, done) {
      filePath = filePath.replace(/^\/+/, '');
      fs.writeFile(path.join(repo.basePath, filePath), data, function(err) {
        repo.gitExec(['add', filePath], function(err, data) {
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