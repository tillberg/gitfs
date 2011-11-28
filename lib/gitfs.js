require('tillberg_common');
var Repo = require('./repo').Repo;
var async = require('async');
var path = require('path');
var crypto = require('crypto');
var _ = require('underscore')._;

var Git = proto();
Git.init = function (rootPath) {
  this.rootPath = rootPath;
  if (!this.rootPath || this.rootPath.length === 0) {
    console.error('You probably don\'t mean to set rootPath to ' + this.rootPath);
    process.exit(1);
  }
  this.ready = async.memoize(readyGen(this));
  this.repo = _.memoize(getRepoGen(this));
};

function readyGen (self) {
  return function (cb) {
    exec('mkdir', ['-p', self.rootPath], { cwd: './' }, function() {
      cb(null, self);
    });
  };
}

function getRepoGen (self) {
  return function (url) {
    var shasum = crypto.createHash('sha1');
    var urlSafe = crypto.createHash('sha1').update(url).digest('hex');
    var repoPath = path.join(self.rootPath, urlSafe);
    return Repo.make(self, repoPath, url);
  };
}

function getGit(tmpDir) {
  return Git.make(tmpDir || 'gitfs-var/');
}
var getGitMemo = _.memoize(getGit);

// By default, gitfs will just use the gitfs-var subdirectory
// of the working directory.
module.exports = getGitMemo();

// You can specify your own working folder using
// `var gitfs = require('gitfs').workspace('some/other/folder');`
module.exports.workspace = getGitMemo;

module.exports.workspaceNoMemo = getGit;
