/** @babel */

import fs from 'fs'
import path from 'path'
import dedent from 'dedent-js'
import sinon from 'sinon'
import Git from 'nodegit'

import {cloneRepository, buildRepository, assertDeepPropertyVals, createEmptyCommit, createLocalAndRemoteRepositories} from '../helpers'

describe('Repository', function () {
  describe('refreshing staged and unstaged changes', () => {
    it('returns a promise resolving to an array of FilePatch objects', async () => {
      const workingDirPath = await cloneRepository('three-files')
      fs.writeFileSync(path.join(workingDirPath, 'a.txt'), 'qux\nfoo\nbar\n', 'utf8')
      fs.unlinkSync(path.join(workingDirPath, 'b.txt'))
      fs.renameSync(path.join(workingDirPath, 'c.txt'), path.join(workingDirPath, 'd.txt'))
      fs.writeFileSync(path.join(workingDirPath, 'e.txt'), 'qux', 'utf8')

      const repo = await buildRepository(workingDirPath)
      const filePatches = await repo.refreshUnstagedChanges()

      assertDeepPropertyVals(filePatches, [
        {
          oldPath: 'a.txt',
          newPath: 'a.txt',
          status: 'modified',
          hunks: [
            {
              lines: [
                {status: 'added', text: 'qux', oldLineNumber: -1, newLineNumber: 1},
                {status: 'unchanged', text: 'foo', oldLineNumber: 1, newLineNumber: 2},
                {status: 'added', text: 'bar', oldLineNumber: -1, newLineNumber: 3}
              ]
            }
          ]
        },
        {
          oldPath: 'b.txt',
          newPath: null,
          status: 'removed',
          hunks: [
            {
              lines: [
                {status: 'removed', text: 'bar', oldLineNumber: 1, newLineNumber: -1}
              ]
            }
          ]
        },
        {
          oldPath: 'c.txt',
          newPath: null,
          status: 'removed',
          hunks: [
            {
              lines: [
                {status: 'removed', text: 'baz', oldLineNumber: 1, newLineNumber: -1}
              ]
            }
          ]
        },
        {
          oldPath: null,
          newPath: 'd.txt',
          status: 'added',
          hunks: [
            {
              lines: [
                {status: 'added', text: 'baz', oldLineNumber: -1, newLineNumber: 1}
              ]
            }
          ]
        },
        {
          oldPath: null,
          newPath: 'e.txt',
          status: 'added',
          hunks: [
            {
              lines: [
                {status: 'added', text: 'qux', oldLineNumber: -1, newLineNumber: 1},
                {status: undefined, text: '\\ No newline at end of file', oldLineNumber: -1, newLineNumber: 1}
              ]
            }
          ]
        }
      ])
    })

    // TODO: remove after extracting selection state logic to components
    xit('reuses the same FilePatch objects if they are equivalent', async () => {
      const workingDirPath = await cloneRepository('three-files')
      const repo = await buildRepository(workingDirPath)
      fs.writeFileSync(path.join(workingDirPath, 'a.txt'), 'qux\nfoo\nbar', 'utf8')
      fs.unlinkSync(path.join(workingDirPath, 'b.txt'))
      fs.renameSync(path.join(workingDirPath, 'c.txt'), path.join(workingDirPath, 'd.txt'))
      fs.writeFileSync(path.join(workingDirPath, 'e.txt'), 'qux', 'utf8')
      const unstagedFilePatches1 = await repo.refreshUnstagedChanges()

      fs.writeFileSync(path.join(workingDirPath, 'a.txt'), 'baz\nfoo\nqux', 'utf8')
      fs.renameSync(path.join(workingDirPath, 'd.txt'), path.join(workingDirPath, 'z.txt'))
      fs.unlinkSync(path.join(workingDirPath, 'e.txt'))
      const unstagedFilePatches2 = await repo.refreshUnstagedChanges()

      assert.equal(unstagedFilePatches1.length, 4)
      assert.equal(unstagedFilePatches2.length, 3)
      assert.equal(unstagedFilePatches1[0], unstagedFilePatches2[0])
      assert.equal(unstagedFilePatches1[1], unstagedFilePatches2[1])
      assert.notEqual(unstagedFilePatches1[2], unstagedFilePatches2[2])
      assert(unstagedFilePatches1[3].isDestroyed())

      await repo.stageFile(unstagedFilePatches2[0].getPath())
      await repo.stageFile(unstagedFilePatches2[1].getPath())
      await repo.stageFile(unstagedFilePatches2[2].getPath())
      const stagedFilePatches1 = await repo.refreshStagedChanges()

      await repo.stageFile(stagedFilePatches1[2].getUnstagePatch().getPath())
      const stagedFilePatches2 = await repo.refreshStagedChanges()
      const unstagedFilePatches3 = await repo.refreshUnstagedChanges()

      assert.equal(stagedFilePatches1.length, 3)
      assert.equal(stagedFilePatches2.length, 2)
      assert.equal(unstagedFilePatches3.length, 1)
      assert.equal(stagedFilePatches1[0], stagedFilePatches2[0])
      assert.equal(stagedFilePatches1[1], stagedFilePatches2[1])
      assert.notEqual(stagedFilePatches1[2], unstagedFilePatches3[0])
      assert(stagedFilePatches1[2].isDestroyed())
    })
  })

  describe('staging and unstaging files', () => {
    it('can stage and unstage modified files', async () => {
      const workingDirPath = await cloneRepository('three-files')
      const repo = await buildRepository(workingDirPath)
      fs.writeFileSync(path.join(workingDirPath, 'subdir-1', 'a.txt'), 'qux\nfoo\nbar\n', 'utf8')
      const [patch] = await repo.getUnstagedChanges()
      const filePath = patch.getPath()

      await repo.stageFile(filePath)
      assert.deepEqual(await repo.getUnstagedChanges(), [])
      assert.deepEqual(await repo.getStagedChanges(), [patch])

      await repo.unstageFile(filePath)
      assert.deepEqual(await repo.getUnstagedChanges(), [patch])
      assert.deepEqual(await repo.getStagedChanges(), [])
    })

    it('can stage and unstage removed files', async () => {
      const workingDirPath = await cloneRepository('three-files')
      const repo = await buildRepository(workingDirPath)
      fs.unlinkSync(path.join(workingDirPath, 'subdir-1', 'b.txt'))
      const [patch] = await repo.getUnstagedChanges()
      const filePath = patch.getPath()

      await repo.stageFile(filePath)
      assert.deepEqual(await repo.getUnstagedChanges(), [])
      assert.deepEqual(await repo.getStagedChanges(), [patch])

      await repo.unstageFile(filePath)
      assert.deepEqual(await repo.getUnstagedChanges(), [patch])
      assert.deepEqual(await repo.getStagedChanges(), [])
    })

    it('can stage and unstage renamed files', async () => {
      const workingDirPath = await cloneRepository('three-files')
      const repo = await buildRepository(workingDirPath)
      fs.renameSync(path.join(workingDirPath, 'c.txt'), path.join(workingDirPath, 'subdir-1', 'd.txt'))
      const patches = await repo.getUnstagedChanges()
      const filePath1 = patches[0].getPath()
      const filePath2 = patches[1].getPath()

      await repo.stageFile(filePath1)
      await repo.stageFile(filePath2)
      assert.deepEqual(await repo.refreshStagedChanges(), patches)
      assert.deepEqual(await repo.getUnstagedChanges(), [])

      await repo.unstageFile(filePath1)
      await repo.unstageFile(filePath2)
      assert.deepEqual(await repo.getUnstagedChanges(), patches)
      assert.deepEqual(await repo.getStagedChanges(), [])
    })

    it('can stage and unstage added files', async () => {
      const workingDirPath = await cloneRepository('three-files')
      fs.writeFileSync(path.join(workingDirPath, 'subdir-1', 'e.txt'), 'qux', 'utf8')
      const repo = await buildRepository(workingDirPath)
      const [patch] = await repo.getUnstagedChanges()
      const filePath = patch.getPath()

      await repo.stageFile(filePath)
      assert.deepEqual(await repo.getUnstagedChanges(), [])
      assert.deepEqual(await repo.getStagedChanges(), [patch])

      await repo.unstageFile(filePath)
      assert.deepEqual(await repo.getUnstagedChanges(), [patch])
      assert.deepEqual(await repo.getStagedChanges(), [])
    })
  })

  describe('applyPatchToIndex', () => {
    it('can stage and unstage modified files', async () => {
      const workingDirPath = await cloneRepository('three-files')
      const repo = await buildRepository(workingDirPath)
      fs.writeFileSync(path.join(workingDirPath, 'subdir-1', 'a.txt'), 'qux\nfoo\nbar\n', 'utf8')
      const [unstagedPatch1] = await repo.getUnstagedChanges()

      fs.writeFileSync(path.join(workingDirPath, 'subdir-1', 'a.txt'), 'qux\nfoo\nbar\nbaz\n', 'utf8')
      await repo.refreshUnstagedChanges()
      const [unstagedPatch2] = await repo.getUnstagedChanges()

      await repo.applyPatchToIndex(unstagedPatch1)
      assertDeepPropertyVals(await repo.getStagedChanges(), [unstagedPatch1])
      const unstagedChanges = await repo.getUnstagedChanges()
      assert.equal(unstagedChanges.length, 1)

      await repo.applyPatchToIndex(unstagedPatch1.getUnstagePatch())
      assert.deepEqual(await repo.getStagedChanges(), [])
      assertDeepPropertyVals(await repo.getUnstagedChanges(), [unstagedPatch2])
    })

    // TODO: remove after selection state logic has moved to components
    xit('emits update events on file patches that change as a result of staging', async () => {
      const workdirPath = await cloneRepository('multi-line-file')
      const repository = await buildRepository(workdirPath)
      const filePath = path.join(workdirPath, 'sample.js')
      const originalLines = fs.readFileSync(filePath, 'utf8').split('\n')
      const unstagedLines = originalLines.slice()
      unstagedLines.splice(1, 1,
        'this is a modified line',
        'this is a new line',
        'this is another new line'
      )
      unstagedLines.splice(11, 2, 'this is a modified line')
      fs.writeFileSync(filePath, unstagedLines.join('\n'))
      const [unstagedFilePatch] = await repository.getUnstagedChanges()
      const unstagedListener = sinon.spy()
      unstagedFilePatch.onDidUpdate(unstagedListener)

      await repository.applyPatchToIndex(unstagedFilePatch.getStagePatchForHunk(unstagedFilePatch.getHunks()[1]))
      assert.equal(unstagedListener.callCount, 1)

      const [stagedFilePatch] = await repository.getStagedChanges()
      const stagedListener = sinon.spy()
      stagedFilePatch.onDidUpdate(stagedListener)

      const unstagePatch = stagedFilePatch.getUnstagePatchForLines(new Set(stagedFilePatch.getHunks()[0].getLines().slice(4, 5)))
      await repository.applyPatchToIndex(unstagePatch)
      assert(stagedListener.callCount, 1)
      assert(unstagedListener.callCount, 2)
    })
  })

  describe('commit', () => {
    it('creates a commit that contains the staged changes', async () => {
      const workingDirPath = await cloneRepository('three-files')
      const repo = await buildRepository(workingDirPath)
      assert.equal((await repo.getLastCommit()).message, 'Initial commit')

      fs.writeFileSync(path.join(workingDirPath, 'subdir-1', 'a.txt'), 'qux\nfoo\nbar\n', 'utf8')
      const [unstagedPatch1] = await repo.getUnstagedChanges()
      fs.writeFileSync(path.join(workingDirPath, 'subdir-1', 'a.txt'), 'qux\nfoo\nbar\nbaz\n', 'utf8')
      await repo.refresh()
      await repo.applyPatchToIndex(unstagedPatch1)
      await repo.commit('Commit 1')
      assert.equal((await repo.getLastCommit()).message, 'Commit 1')
      await repo.refresh()
      assert.deepEqual(await repo.getStagedChanges(), [])
      const unstagedChanges = await repo.getUnstagedChanges()
      assert.equal(unstagedChanges.length, 1)

      await repo.applyPatchToIndex(unstagedChanges[0])
      await repo.commit('Commit 2')
      assert.equal((await repo.getLastCommit()).message, 'Commit 2')
      await repo.refresh()
      assert.deepEqual(await repo.getStagedChanges(), [])
      assert.deepEqual(await repo.getUnstagedChanges(), [])
    })

    it('throws an error when there are unmerged files', async () => {
      const workingDirPath = await cloneRepository('merge-conflict')
      const repository = await buildRepository(workingDirPath)
      try {
        await repository.git.exec(['merge', 'origin/branch'])
        assert.fail('expect merge to fail')
      } catch (e) {
        // expected
      }

      assert.equal(await repository.isMerging(), true)
      const mergeBase = await repository.getLastCommit()

      try {
        await repository.commit('Merge Commit')
        assert.fail('expect merge commit to fail')
      } catch (e) {
        assert.isAbove(e.code, 0)
        assert.match(e.command, /^git commit/)
      }

      assert.equal(await repository.isMerging(), true)
      assert.equal((await repository.getLastCommit()).toString(), mergeBase.toString())
    })

    it('strips out comments', async () => {
      const workingDirPath = await cloneRepository('three-files')
      const repo = await buildRepository(workingDirPath)

      fs.writeFileSync(path.join(workingDirPath, 'subdir-1', 'a.txt'), 'qux\nfoo\nbar\n', 'utf8')
      await repo.stageFile(path.join('subdir-1', 'a.txt'))
      await repo.commit([
        'Make a commit',
        '',
        '# Comments:',
        '#	blah blah blah',
        '#	other stuff'
      ].join('\n'))

      assert.deepEqual((await repo.getLastCommit()).message, 'Make a commit')
    })
  })

  xdescribe('pull()', () => {
    it('brings commits from the remote', async () => {
      const {localRepoPath, remoteRepoPath} = await createLocalAndRemoteRepositories()
      const localRepo = await buildRepository(localRepoPath)
      const remoteRepo = await Git.Repository.open(remoteRepoPath)

      await createEmptyCommit(remoteRepoPath, 'new remote commit')

      assert.notEqual((await remoteRepo.getMasterCommit()).message(), (await localRepo.getLastCommit()).message)

      await localRepo.pull('master')
      assert.equal((await remoteRepo.getMasterCommit()).message(), (await localRepo.getLastCommit()).message)
    })
  })

  xdescribe('push()', () => {
    it('sends commits to the remote and updates ', async () => {
      const {localRepoPath, remoteRepoPath} = await createLocalAndRemoteRepositories()
      const localRepo = await buildRepository(localRepoPath)
      const remoteRepo = await Git.Repository.open(remoteRepoPath)

      fs.writeFileSync(path.join(localRepoPath, 'subdir-1', 'a.txt'), 'qux\nfoo\nbar\n', 'utf8')
      const [unstagedFilePatch] = await localRepo.getUnstagedChanges()
      await localRepo.applyPatchToIndex(unstagedFilePatch)
      await localRepo.commit('new local commit')

      assert.notEqual((await remoteRepo.getMasterCommit()).message(), (await localRepo.getLastCommit()).message)

      await localRepo.push('master')
      assert.equal((await remoteRepo.getMasterCommit()).message(), (await localRepo.getLastCommit()).message + '\n')
    })
  })

  xdescribe('getAheadBehindCount(branchName)', () => {
    it('returns the number of commits ahead and behind the remote', async () => {
      const {localRepoPath, remoteRepoPath} = await createLocalAndRemoteRepositories()
      const localRepo = await buildRepository(localRepoPath)
      const remoteRepo = await Git.Repository.open(remoteRepoPath)

      await createEmptyCommit(remoteRepoPath, 'new remote commit')
      assert.equal((await remoteRepo.getMasterCommit()).message(), 'new remote commit')

      fs.writeFileSync(path.join(localRepoPath, 'subdir-1', 'a.txt'), 'qux\nfoo\nbar\n', 'utf8')
      const [unstagedFilePatch] = await localRepo.getUnstagedChanges()
      await localRepo.applyPatchToIndex(unstagedFilePatch)
      await localRepo.commit('new local commit')

      assert.equal((await localRepo.getLastCommit()).message, 'new local commit')

      let {ahead, behind} = await localRepo.getAheadBehindCount('master')
      assert.equal(behind, 0)
      assert.equal(ahead, 1)

      await localRepo.fetch('master')
      const counts = await localRepo.getAheadBehindCount('master')
      ahead = counts.ahead
      behind = counts.behind
      assert.equal(behind, 1)
      assert.equal(ahead, 1)
    })
  })

  xdescribe('getBranchRemoteName(branchName)', () => {
    it('returns the remote name associated to the supplied branch name', async () => {
      const {localRepoPath} = await createLocalAndRemoteRepositories('three-files')
      const repository = await buildRepository(localRepoPath)
      assert.equal(await repository.getBranchRemoteName('master'), 'origin')
    })

    it('returns null if there is no remote associated with the supplied branch name', async () => {
      const workingDirPath = await cloneRepository('three-files')
      const repository = await buildRepository(workingDirPath)
      assert.isNull(await repository.getBranchRemoteName('master'))
    })
  })

  describe('merge conflicts', () => {
    describe('refreshMergeConflicts()', () => {
      it('returns a promise resolving to an array of MergeConflict objects', async () => {
        const workingDirPath = await cloneRepository('merge-conflict')
        const repo = await buildRepository(workingDirPath)
        try {
          await repo.git.exec(['merge', 'origin/branch'])
          assert.fail('expect merge to fail')
        } catch (e) {
          // expected
        }

        let mergeConflicts = await repo.refreshMergeConflicts()
        const expected = [
          {
            path: 'added-to-both.txt',
            fileStatus: 'modified',
            oursStatus: 'added',
            theirsStatus: 'added'
          },
          {
            path: 'modified-on-both-ours.txt',
            fileStatus: 'modified',
            oursStatus: 'modified',
            theirsStatus: 'modified'
          },
          {
            path: 'modified-on-both-theirs.txt',
            fileStatus: 'modified',
            oursStatus: 'modified',
            theirsStatus: 'modified'
          },
          {
            path: 'removed-on-branch.txt',
            fileStatus: 'equivalent',
            oursStatus: 'modified',
            theirsStatus: 'removed'
          },
          {
            path: 'removed-on-master.txt',
            fileStatus: 'added',
            oursStatus: 'removed',
            theirsStatus: 'modified'
          }
        ]

        assertDeepPropertyVals(mergeConflicts, expected)

        fs.unlinkSync(path.join(workingDirPath, 'removed-on-branch.txt'))
        mergeConflicts = await repo.refreshMergeConflicts()

        expected[3].fileStatus = 'removed'
        assertDeepPropertyVals(mergeConflicts, expected)
      })

      // TODO: ignore as we are pulling selection state logic into components
      xit('reuses the same MergeConflict objects if they are equivalent', async () => {
        const workingDirPath = await cloneRepository('merge-conflict')
        const repo = await buildRepository(workingDirPath)
        const mergeConflicts1 = await repo.refreshMergeConflicts()

        await repo.stageFile('removed-on-master.txt')
        const mergeConflicts2 = await repo.refreshMergeConflicts()

        assert.equal(mergeConflicts1.length, 5)
        assert.equal(mergeConflicts2.length, 4)
        assert.equal(mergeConflicts1[0], mergeConflicts2[0])
        assert.equal(mergeConflicts1[1], mergeConflicts2[1])
        assert.equal(mergeConflicts1[2], mergeConflicts2[2])
        assert.equal(mergeConflicts1[3], mergeConflicts2[3])
        assert(mergeConflicts1[4].isDestroyed())
      })

      it('returns an empty arry if the repo has no merge conflicts', async () => {
        const workingDirPath = await cloneRepository('three-files')
        const repo = await buildRepository(workingDirPath)

        const mergeConflicts = await repo.getMergeConflicts()
        assert.deepEqual(mergeConflicts, [])
      })
    })

    describe('stageFile(path)', () => {
      it('updates the staged changes accordingly', async () => {
        const workingDirPath = await cloneRepository('merge-conflict')
        const repo = await buildRepository(workingDirPath)
        try {
          await repo.git.exec(['merge', 'origin/branch'])
          assert.fail('expect merge to fail')
        } catch (e) {
          // expected
        }

        const mergeConflictPaths = (await repo.getMergeConflicts()).map(c => c.getPath())
        assert.deepEqual(mergeConflictPaths, ['added-to-both.txt', 'modified-on-both-ours.txt', 'modified-on-both-theirs.txt', 'removed-on-branch.txt', 'removed-on-master.txt'])

        let stagedFilePatches = await repo.refreshStagedChanges()
        assert.deepEqual(stagedFilePatches.map(patch => patch.getPath()), [])

        await repo.stageFile('added-to-both.txt')
        stagedFilePatches = await repo.refreshStagedChanges()
        assert.deepEqual(stagedFilePatches.map(patch => patch.getPath()), ['added-to-both.txt'])

        // choose version of the file on head
        fs.writeFileSync(path.join(workingDirPath, 'modified-on-both-ours.txt'), 'master modification\n', 'utf8')
        await repo.stageFile('modified-on-both-ours.txt')
        stagedFilePatches = await repo.refreshStagedChanges()
        // nothing additional to stage
        assert.deepEqual(stagedFilePatches.map(patch => patch.getPath()), ['added-to-both.txt'])

        // choose version of the file on branch
        fs.writeFileSync(path.join(workingDirPath, 'modified-on-both-ours.txt'), 'branch modification\n', 'utf8')
        await repo.stageFile('modified-on-both-ours.txt')
        stagedFilePatches = await repo.refreshStagedChanges()
        assert.deepEqual(stagedFilePatches.map(patch => patch.getPath()), ['added-to-both.txt', 'modified-on-both-ours.txt'])

        // remove file that was deleted on branch
        fs.unlinkSync(path.join(workingDirPath, 'removed-on-branch.txt'))
        await repo.stageFile('removed-on-branch.txt')
        stagedFilePatches = await repo.refreshStagedChanges()
        assert.deepEqual(stagedFilePatches.map(patch => patch.getPath()), ['added-to-both.txt', 'modified-on-both-ours.txt', 'removed-on-branch.txt'])

        // remove file that was deleted on master
        fs.unlinkSync(path.join(workingDirPath, 'removed-on-master.txt'))
        await repo.stageFile('removed-on-master.txt')
        stagedFilePatches = await repo.refreshStagedChanges()
        // nothing additional to stage
        assert.deepEqual(stagedFilePatches.map(patch => patch.getPath()), ['added-to-both.txt', 'modified-on-both-ours.txt', 'removed-on-branch.txt'])
      })
    })

    describe('pathHasMergeMarkers()', () => {
      it('returns true if and only if the file has merge markers', async () => {
        const workingDirPath = await cloneRepository('merge-conflict')
        const repo = await buildRepository(workingDirPath)
        try {
          await repo.git.exec(['merge', 'origin/branch'])
          assert.fail('expect merge to fail')
        } catch (e) {
          // expected
        }

        assert.isTrue(await repo.pathHasMergeMarkers('added-to-both.txt'))
        assert.isFalse(await repo.pathHasMergeMarkers('removed-on-master.txt'))

        fs.writeFileSync(path.join(workingDirPath, 'file-with-chevrons.txt'), dedent`
          no branch name:
          >>>>>>>
          <<<<<<<

          not enough chevrons:
          >>> HEAD
          <<< branch

          too many chevrons:
          >>>>>>>>> HEAD
          <<<<<<<<< branch

          too many words after chevrons:
          >>>>>>> blah blah blah
          <<<<<<< blah blah blah

          not at line beginning:
          foo >>>>>>> bar
          baz <<<<<<< qux
        `)
        assert.isFalse(await repo.pathHasMergeMarkers('file-with-chevrons.txt'))

        assert.isFalse(await repo.pathHasMergeMarkers('nonexistent-file.txt'))
      })
    })

    describe('abortMerge()', () => {
      describe('when the working directory is clean', () => {
        it('resets the index and the working directory to match HEAD', async () => {
          const workingDirPath = await cloneRepository('merge-conflict-abort')
          const repo = await buildRepository(workingDirPath)
          try {
            await repo.git.exec(['merge', 'origin/spanish'])
            assert.fail('expected merge to fail')
          } catch (e) {
            // expected
          }
          assert.equal(await repo.isMerging(), true)
          assert.equal(await repo.hasMergeConflict(), true)
          await repo.abortMerge()
          assert.equal(await repo.isMerging(), false)
          assert.equal(await repo.hasMergeConflict(), false)
        })
      })

      describe('when a dirty file in the working directory is NOT in the staging area', () => {
        it('throws an error indicating that the abort could not be completed', async () => {
          const workingDirPath = await cloneRepository('merge-conflict-abort')
          const repo = await buildRepository(workingDirPath)
          try {
            await repo.git.exec(['merge', 'origin/spanish'])
            assert.fail('expect merge to fail')
          } catch (e) {
            // expected
          }

          fs.writeFileSync(path.join(workingDirPath, 'fruit.txt'), 'a change\n')
          assert.equal(await repo.isMerging(), true)
          assert.equal(await repo.hasMergeConflict(), true)

          await repo.abortMerge()
          assert.equal(await repo.isMerging(), false)
          assert.equal(await repo.hasMergeConflict(), false)
          assert.equal((await repo.refreshStagedChanges()).length, 0)
          assert.equal((await repo.refreshUnstagedChanges()).length, 1)
          assert.equal(fs.readFileSync(path.join(workingDirPath, 'fruit.txt')), 'a change\n')
        })
      })

      describe('when a dirty file in the working directory is in the staging area', () => {
        it('throws an error indicating that the abort could not be completed', async () => {
          const workingDirPath = await cloneRepository('merge-conflict-abort')
          const repo = await buildRepository(workingDirPath)
          try {
            await repo.git.exec(['merge', 'origin/spanish'])
            assert.fail('expect merge to fail')
          } catch (e) {
            // expected
          }

          fs.writeFileSync(path.join(workingDirPath, 'animal.txt'), 'a change\n')
          const stagedChanges = await repo.refreshStagedChanges()
          const unstagedChanges = await repo.refreshUnstagedChanges()

          assert.equal(await repo.isMerging(), true)
          assert.equal(await repo.hasMergeConflict(), true)
          try {
            await repo.abortMerge()
            assert(false)
          } catch (e) {
            assert.equal(e.code, 'EDIRTYSTAGED')
            assert.equal(e.path, 'animal.txt')
          }
          assert.equal(await repo.isMerging(), true)
          assert.equal(await repo.hasMergeConflict(), true)
          assert.deepEqual(await repo.refreshStagedChanges(), stagedChanges)
          assert.deepEqual(await repo.refreshUnstagedChanges(), unstagedChanges)
        })
      })
    })
  })
})
