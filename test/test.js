
var fs = require('fs');
var vows = require('vows');
var assert = require('assert');
var _ = require('underscore');

var git = require('../lib/git');
var Git = git.Git;
var Repo = require('../lib/repo').Repo;
var Version = git.Version;

function getGit() {
  return Git.make();
}

var tests = vows.describe('Basic Git');

tests.addBatch({
 'When we load up Git': {
    topic: getGit,
    'we should get a Git object': function(git) {
      assert.ok(git.is(Git));
    }
  }
});

function ctxLoadRepo() {
  var match = this.context.name.match(/When we load (.*)/);
  if (!match) { error('Could not parse ' + this.context.name); }
  var url = match[1];
  var self = this;
  Git.make('var').ready(function(err, git) {
    self.callback(null, git.getRepo(url));
  });
}

function ctxBranchList(repo) {
  var self = this;
  repo.getBranches(function(branches) {
    self.callback(null, branches);
  });
}


tests.addBatch({
  'When we load git://github.com/tillberg/euler.git': {
    topic: ctxLoadRepo,
    'we should get a Repo object': function(repo) {
      assert.ok(repo.is(Repo));
    },
    'we get an eventEmitter back': function(repo) {
      assert.ok(repo.on);
      assert.ok(repo.once);
      assert.ok(repo.emit);
    },
    'and get the list of branches': {
      topic: ctxBranchList,
      'we get one branch called master': function(branches) {
        assert.lengthOf(branches, 1);
        assert.equals(branches[0], 'master');
      }
    }
  }
});

tests.export(module);
