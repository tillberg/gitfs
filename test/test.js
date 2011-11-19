
var fs = require('fs');
var vows = require('vows');
var assert = require('assert');
var _ = require('underscore');
var crypto = require('crypto');
var async = require('async');

var gitfs = require('../lib/git');
var Repo = require('../lib/repo').Repo;

var cleanUpPrevious = async.memoize(function (cb) {
  // This cleans out previous test runs
  exec('rm', ['-rf', 'var/'], { cwd: './' }, function() {
    cb();
  });
});

function getGit(index, cb) {
  cleanUpPrevious(function() {
    if (index === null) {
      cb(gitfs);
    } else {
      cb(gitfs.workspace('var/t' + index));
    }
  });
}

var gitfsTests = vows.describe('gitfs Object');

function ctxGit(index) {
  return function() {
    var cb = this.callback;
    getGit(index, function(git) {
      cb(null, git);
    });
  };
}

gitfsTests.addBatch({
  'When we load up Git': {
    topic: ctxGit(0),
    'we should get a Git object': function(git) {
      assert.isFunction(git.repo);
    },
    'and get another Git with the same index': {
      topic: ctxGit(0),
      'they are the same object': function(git) {
        assert.equal(git, this.context.topics[1]);
      }
    }
  },
  'We can also just get the default Git': {
    topic: ctxGit(null),
    'and its rootPath should be `gitfs-var/`': function(git) {
      assert.ok(git);
      assert.equal(git.rootPath, 'gitfs-var/');
    },
    'and if we load up the 0-index Git': {
      topic: ctxGit(0),
      'it should be a different object': function(git) {
        assert.notEqual(git, this.context.topics[1]);
      }
    }
  }
});
gitfsTests.export(module);

var commands = {
  'list branches': function(repo, cb) {
    repo.getBranches(function(branches) {
      cb(null, branches);
    });
  },
  'get Repo': function(repo, cb) {
    cb(null, repo);
  }
};

var nextSuiteIndex = 1;
function ctxLoad() {
  var suiteIndex = this.suite._index = this.suite._index || nextSuiteIndex++;
  var callback = this.callback;
  var match = this.context.name.match(/we (.+) of (.+)$/);
  if (!match) { return callback('Test error, could not parse ' + this.context.name); }
  var url = match[2];
  var command = match[1];
  if (!commands[command]) { return callback('Test error, could not find parsed command: ' + command); }
  var self = this;
  getGit(suiteIndex, function(git) {
    var repo = git.repo(url);
    commands[command](repo, callback);
  });
}

var repoFuncTests = vows.describe('Repo Functionality');

repoFuncTests.addBatch({
  'When we list branches of git://github.com/tillberg/euler.git': {
    topic: ctxLoad,
    'we get an array of branch names': function(branches) {
      assert.lengthOf(branches, 1);
      assert.equal(branches[0], 'master');
    }
  },
  'When we get Repo of git://github.com/tillberg/euler.git': {
    topic: ctxLoad,
    'we get a Repo object': function(repo) {
      assert.ok(repo.is(Repo));
    },
    'the basePath ends with a sha1 in hex of the repo': function(repo) {
      assert.isString(repo.basePath);
      assert.match(repo.basePath, /\/[0-9a-f]{40}$/);
      var expBasePath = crypto.createHash('sha1').update(repo.url).digest('hex');
      assert.equal(_.last(repo.basePath.split('/')), expBasePath);
    },
    'and then we get Repo of git://github.com/tillberg/euler.git': {
      topic: ctxLoad,
      'it is the same as the first time we got that repo': function(repo) {
        assert.equal(repo, this.context.topics[1]);
      }
    }
  }
});
repoFuncTests.export(module);

var basicUsageTests = vows.describe('Basic Usage');
basicUsageTests.addBatch({
  'If we load a file from a repo': {
    topic: function() {
      gitfs.repo('git://github.com/tillberg/euler.git').readFile('README', this.callback);
    },
    'We should get the contents': function(err, data) {
      assert.match(data, /Project Euler in Ruby and Scala/);
    }
  }
});
basicUsageTests.export(module);