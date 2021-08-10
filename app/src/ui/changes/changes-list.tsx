import * as React from 'react'
import * as Path from 'path'

import { Dispatcher } from '../dispatcher'
import { IMenuItem } from '../../lib/menu-item'
import { revealInFileManager } from '../../lib/app-shell'
import {
  WorkingDirectoryStatus,
  WorkingDirectoryFileChange,
  AppFileStatusKind,
} from '../../models/status'
import { DiffLineType, DiffSelectionType, DiffType, IDiff } from '../../models/diff'
import { CommitIdentity } from '../../models/commit-identity'
import { ICommitMessage } from '../../models/commit-message'
import { Repository } from '../../models/repository'
import { Account } from '../../models/account'
import { IAuthor } from '../../models/author'
import { List, ClickSource } from '../lib/list'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import {
  isSafeFileExtension,
  DefaultEditorLabel,
  CopyFilePathLabel,
  RevealInFileManagerLabel,
  OpenWithDefaultProgramLabel,
} from '../lib/context-menu'
import { CommitMessage } from './commit-message'
import { ChangedFile } from './changed-file'
import { IAutocompletionProvider } from '../autocompletion'
import { showContextualMenu } from '../main-process-proxy'
import { arrayEquals } from '../../lib/equality'
import { clipboard } from 'electron'
import { basename } from 'path'
import { Commit, ICommitContext } from '../../models/commit'
import { RebaseConflictState, ConflictState } from '../../lib/app-state'
import { ContinueRebase } from './continue-rebase'
import { Octicon } from '../octicons'
import * as OcticonSymbol from '../octicons/octicons.generated'
import { IStashEntry } from '../../models/stash-entry'
import classNames from 'classnames'
import { hasWritePermission } from '../../models/github-repository'
import { hasConflictedFiles } from '../../lib/status'
import { FancyTextBox } from '../lib/fancy-text-box'
import { TextBox } from '../lib/text-box'
import { getWorkingDirectoryDiff } from '../../lib/git'
import { stat as fsStat } from 'fs'
import { promisify } from 'util'
const stat = promisify(fsStat)

const RowHeight = 29
const StashIcon: OcticonSymbol.OcticonSymbolType = {
  w: 16,
  h: 16,
  d:
    'M10.5 1.286h-9a.214.214 0 0 0-.214.214v9a.214.214 0 0 0 .214.214h9a.214.214 0 0 0 ' +
    '.214-.214v-9a.214.214 0 0 0-.214-.214zM1.5 0h9A1.5 1.5 0 0 1 12 1.5v9a1.5 1.5 0 0 1-1.5 ' +
    '1.5h-9A1.5 1.5 0 0 1 0 10.5v-9A1.5 1.5 0 0 1 1.5 0zm5.712 7.212a1.714 1.714 0 1 ' +
    '1-2.424-2.424 1.714 1.714 0 0 1 2.424 2.424zM2.015 12.71c.102.729.728 1.29 1.485 ' +
    '1.29h9a1.5 1.5 0 0 0 1.5-1.5v-9a1.5 1.5 0 0 0-1.29-1.485v1.442a.216.216 0 0 1 ' +
    '.004.043v9a.214.214 0 0 1-.214.214h-9a.216.216 0 0 1-.043-.004H2.015zm2 2c.102.729.728 ' +
    '1.29 1.485 1.29h9a1.5 1.5 0 0 0 1.5-1.5v-9a1.5 1.5 0 0 0-1.29-1.485v1.442a.216.216 0 0 1 ' +
    '.004.043v9a.214.214 0 0 1-.214.214h-9a.216.216 0 0 1-.043-.004H4.015z',
  fr: 'evenodd',
}

const GitIgnoreFileName = '.gitignore'

/** Compute the 'Include All' checkbox value from the repository state */
function getIncludeAllValue(
  workingDirectory: WorkingDirectoryStatus,
  rebaseConflictState: RebaseConflictState | null
) {
  if (rebaseConflictState !== null) {
    if (workingDirectory.files.length === 0) {
      // the current commit will be skipped in the rebase
      return CheckboxValue.Off
    }

    // untracked files will be skipped by the rebase, so we need to ensure that
    // the "Include All" checkbox matches this state
    const onlyUntrackedFilesFound = workingDirectory.files.every(
      f => f.status.kind === AppFileStatusKind.Untracked
    )

    if (onlyUntrackedFilesFound) {
      return CheckboxValue.Off
    }

    const onlyTrackedFilesFound = workingDirectory.files.every(
      f => f.status.kind !== AppFileStatusKind.Untracked
    )

    // show "Mixed" if we have a mixture of tracked and untracked changes
    return onlyTrackedFilesFound ? CheckboxValue.On : CheckboxValue.Mixed
  }

  const { includeAll } = workingDirectory
  if (includeAll === true) {
    return CheckboxValue.On
  } else if (includeAll === false) {
    return CheckboxValue.Off
  } else {
    return CheckboxValue.Mixed
  }
}

interface IChangesListProps {
  readonly repository: Repository
  readonly repositoryAccount: Account | null
  readonly workingDirectory: WorkingDirectoryStatus
  readonly mostRecentLocalCommit: Commit | null
  /**
   * An object containing the conflicts in the working directory.
   * When null it means that there are no conflicts.
   */
  readonly conflictState: ConflictState | null
  readonly rebaseConflictState: RebaseConflictState | null
  readonly selectedFileIDs: ReadonlyArray<string>
  readonly onFileSelectionChanged: (files: WorkingDirectoryFileChange[]) => void
  readonly onIncludeChanged: (path: string, include: boolean) => void
  readonly onSelectAll: (selectAll: boolean) => void
  readonly onCreateCommit: (context: ICommitContext) => Promise<boolean>
  readonly onDiscardChanges: (file: WorkingDirectoryFileChange) => void
  readonly askForConfirmationOnDiscardChanges: boolean
  readonly focusCommitMessage: boolean
  readonly onDiscardChangesFromFiles: (
    files: ReadonlyArray<WorkingDirectoryFileChange>,
    isDiscardingAllChanges: boolean
  ) => void

  /** Callback that fires on page scroll to pass the new scrollTop location */
  readonly onChangesListScrolled: (scrollTop: number) => void

  /* The scrollTop of the compareList. It is stored to allow for scroll position persistence */
  readonly changesListScrollTop?: number

  /**
   * Called to open a file it its default application
   *
   * @param path The path of the file relative to the root of the repository
   */
  readonly onOpenItem: (path: string) => void
  /**
   * The currently checked out branch (null if no branch is checked out).
   */
  readonly branch: string | null
  readonly commitAuthor: CommitIdentity | null
  readonly dispatcher: Dispatcher
  readonly availableWidth: number
  readonly isCommitting: boolean
  readonly isAmending: boolean
  readonly currentBranchProtected: boolean

  /**
   * Click event handler passed directly to the onRowClick prop of List, see
   * List Props for documentation.
   */
  readonly onRowClick?: (file: WorkingDirectoryFileChange, source: ClickSource) => void
  readonly commitMessage: ICommitMessage

  /** The autocompletion providers available to the repository. */
  readonly autocompletionProviders: ReadonlyArray<IAutocompletionProvider<any>>

  /** Called when the given pattern should be ignored. */
  readonly onIgnore: (pattern: string | string[]) => void

  /**
   * Whether or not to show a field for adding co-authors to
   * a commit (currently only supported for GH/GHE repositories)
   */
  readonly showCoAuthoredBy: boolean

  /**
   * A list of authors (name, email pairs) which have been
   * entered into the co-authors input box in the commit form
   * and which _may_ be used in the subsequent commit to add
   * Co-Authored-By commit message trailers depending on whether
   * the user has chosen to do so.
   */
  readonly coAuthors: ReadonlyArray<IAuthor>

  /** The name of the currently selected external editor */
  readonly externalEditorLabel?: string

  /**
   * Callback to open a selected file using the configured external editor
   *
   * @param fullPath The full path to the file on disk
   */
  readonly onOpenInExternalEditor: (fullPath: string) => void

  readonly stashEntry: IStashEntry | null

  readonly isShowingStashEntry: boolean

  /**
   * Whether we should show the onboarding tutorial nudge
   * arrow pointing at the commit summary box
   */
  readonly shouldNudgeToCommit: boolean

  readonly commitSpellcheckEnabled: boolean
}

interface IFileChanges {
  changes: IDiff,
  mTime: number
}

interface IChangesState {
  filterDiffText: string
  filterPathText: string
  /** Map from ids of files in the working directory to changed lines in the file for given last modification time */
  fileChanges: { [id: string]: IFileChanges }
  filteredFiles: ReadonlyArray<WorkingDirectoryFileChange>
  // unstagedMatchingFilter: ReadonlyArray<WorkingDirectoryFileChange>
}

export class ChangesList extends React.Component<
  IChangesListProps,
  IChangesState
> {
  private listRef?: List
  private filterDiffTextBoxRef?: TextBox

  public constructor(props: IChangesListProps) {
    super(props)
    this.state = {
      filterDiffText: '',
      filterPathText: '',
      fileChanges: {},
      // unstagedMatchingFilter: props.workingDirectory.files,
      filteredFiles: props.workingDirectory.files
    }
    this.updateFileChanges()
  }

  private getSelectedRows() {
    return this.props.selectedFileIDs.map(fID => this.state.filteredFiles.findIndex(file => file.id === fID)).filter(r => r !== -1)
  }

  public componentWillReceiveProps(nextProps: IChangesListProps) {
    // No need to update state unless we haven't done it yet or the
    // selected file id list has changed.
    if (
      !arrayEquals(
        nextProps.workingDirectory.files,
        this.props.workingDirectory.files
      )
    ) {
      // Immediately fix up any WorkingDirectoryFileChange references in the current state filteredFiles, otherwise UI will break
      const pathsToWDFCs = nextProps.workingDirectory.files.reduce((o, f) => (o[f.path] = f, o), {} as { [path: string]: WorkingDirectoryFileChange })
      this.setState({ ...this.state, filteredFiles: this.state.filteredFiles.map(f => pathsToWDFCs[f.path]).filter(Boolean) })

      // Don't check and recompute file changes if only change is selected row ID(s) as this
      // indicates the user has just changed the file selection not that content changed
      if (arrayEquals(nextProps.selectedFileIDs, this.props.selectedFileIDs)) {
        this.updateFileChanges()
      }
    }
  }

  private updateFileChangesTask?: Promise<any> = undefined
  private async updateFileChanges() {
    await (this.updateFileChangesTask = this.updateFileChangesTask || this.doUpdateFileChanges())
    this.updateFileChangesTask = undefined
    this.updateFilteredFiles()
  }

  private async doUpdateFileChanges() {
    // Use modification times to determine which files to actually get updated changes on
    // 9ms to get modification times of 46 files
    const newFileChanges: IChangesState['fileChanges'] = {}
    let anyChanges = false
    await Promise.all(this.props.workingDirectory.files.map(async f => {
      const fullPath = Path.join(this.props.repository.path, f.path)
      const mTime = (await stat(fullPath)).mtimeMs
      if (mTime === this.state.fileChanges[f.path]?.mTime) {
        // No changes
        newFileChanges[f.path] = this.state.fileChanges[f.path]
      } else {
        // Either file was not in the change list before or mod time has changed. Update the changes record for the file
        newFileChanges[f.path] = {
          mTime,
          changes: await getWorkingDirectoryDiff(this.props.repository, f, false)
        }
        anyChanges = true
      }
    }))
    if (anyChanges) {
      this.setState({ ...this.state, fileChanges: newFileChanges })
    }
  }

  private updateFilteredFiles(filterDiffText: string = this.state.filterDiffText, filterPathText: string = this.state.filterPathText) {
    if (this.updateFileChangesTask) return  // Wait for the updateFileChangesTask to finish updating fileChanges, it will invoke this again once done
    const filteredFiles = this.props.workingDirectory.files.filter(f => {
      if (!f.path.includes(filterPathText)) return false
      if (!filterDiffText) return true
      const changes = this.state.fileChanges[f.path]?.changes
      if (!changes) return console.warn(`Changes not found for ${f.path}`)
      if (changes.kind === DiffType.Text || changes.kind === DiffType.LargeText) {
        return changes.hunks.some(h => h.lines.some(l => l.type !== DiffLineType.Context && l.content.includes(filterDiffText)))
      }
    })

    this.setState({
      ...this.state,
      filterDiffText,
      filterPathText,
      filteredFiles
    })

    // Make sure the current selection is valid
    const validSelectedFileIds = this.props.selectedFileIDs.filter(fID => filteredFiles.find(f => f.id === fID))
    if (!validSelectedFileIds.length) {
      if (filteredFiles.length) {
        this.props.onFileSelectionChanged([filteredFiles[0]])
      } else {
        this.props.onFileSelectionChanged([])
      }
    } else if (validSelectedFileIds.length !== this.props.selectedFileIDs.length) {
      this.props.onFileSelectionChanged(validSelectedFileIds.map(id => this.props.workingDirectory.findFileWithID(id)!).filter(Boolean))
    }
  }

  private onIncludeAllChanged = (event: React.FormEvent<HTMLInputElement>) => {
    const include = event.currentTarget.checked
    this.props.onSelectAll(include)
  }

  private renderRow = (row: number): JSX.Element => {
    const {
      rebaseConflictState,
      isCommitting,
      onIncludeChanged,
      availableWidth,
    } = this.props

    const file = this.state.filteredFiles[row]
    const selection = file.selection.getSelectionType()

    const includeAll =
      selection === DiffSelectionType.All
        ? true
        : selection === DiffSelectionType.None
          ? false
          : null

    const include =
      rebaseConflictState !== null
        ? file.status.kind !== AppFileStatusKind.Untracked
        : includeAll

    const disableSelection = isCommitting || rebaseConflictState !== null

    return (
      <ChangedFile
        file={file}
        include={include}
        key={file.id}
        onContextMenu={this.onItemContextMenu}
        onIncludeChanged={onIncludeChanged}
        availableWidth={availableWidth}
        disableSelection={disableSelection}
      />
    )
  }

  private onDiscardAllChanges = () => {
    this.props.onDiscardChangesFromFiles(
      this.props.workingDirectory.files,
      true
    )
  }

  private onStashChanges = () => {
    this.props.dispatcher.createStashForCurrentBranch(this.props.repository)
  }

  private onDiscardChanges = (files: ReadonlyArray<string>) => {
    const workingDirectory = this.props.workingDirectory

    if (files.length === 1) {
      const modifiedFile = workingDirectory.files.find(f => f.path === files[0])

      if (modifiedFile != null) {
        this.props.onDiscardChanges(modifiedFile)
      }
    } else {
      const modifiedFiles = new Array<WorkingDirectoryFileChange>()

      files.forEach(file => {
        const modifiedFile = workingDirectory.files.find(f => f.path === file)

        if (modifiedFile != null) {
          modifiedFiles.push(modifiedFile)
        }
      })

      if (modifiedFiles.length > 0) {
        // DiscardAllChanges can also be used for discarding several selected changes.
        // Therefore, we update the pop up to reflect whether or not it is "all" changes.
        const discardingAllChanges =
          modifiedFiles.length === workingDirectory.files.length

        this.props.onDiscardChangesFromFiles(
          modifiedFiles,
          discardingAllChanges
        )
      }
    }
  }

  private getDiscardChangesMenuItemLabel = (files: ReadonlyArray<string>) => {
    const label =
      files.length === 1
        ? __DARWIN__
          ? `Discard Changes`
          : `Discard changes`
        : __DARWIN__
          ? `Discard ${files.length} Selected Changes`
          : `Discard ${files.length} selected changes`

    return this.props.askForConfirmationOnDiscardChanges ? `${label}…` : label
  }

  private onContextMenu = (event: React.MouseEvent<any>) => {
    event.preventDefault()

    // need to preserve the working directory state while dealing with conflicts
    if (this.props.rebaseConflictState !== null || this.props.isCommitting) {
      return
    }

    const hasLocalChanges = this.props.workingDirectory.files.length > 0
    const hasStash = this.props.stashEntry !== null
    const hasConflicts =
      this.props.conflictState !== null ||
      hasConflictedFiles(this.props.workingDirectory)

    const stashAllChangesLabel = __DARWIN__
      ? 'Stash All Changes'
      : 'Stash all changes'
    const confirmStashAllChangesLabel = __DARWIN__
      ? 'Stash All Changes…'
      : 'Stash all changes…'

    const items: IMenuItem[] = [
      {
        label: __DARWIN__ ? 'Discard All Changes…' : 'Discard all changes…',
        action: this.onDiscardAllChanges,
        enabled: hasLocalChanges,
      },
      {
        label: hasStash ? confirmStashAllChangesLabel : stashAllChangesLabel,
        action: this.onStashChanges,
        enabled: hasLocalChanges && this.props.branch !== null && !hasConflicts,
      },
    ]

    showContextualMenu(items)
  }

  private getDiscardChangesMenuItem = (
    paths: ReadonlyArray<string>
  ): IMenuItem => {
    return {
      label: this.getDiscardChangesMenuItemLabel(paths),
      action: () => this.onDiscardChanges(paths),
    }
  }

  private getCopyPathMenuItem = (
    file: WorkingDirectoryFileChange
  ): IMenuItem => {
    return {
      label: CopyFilePathLabel,
      action: () => {
        const fullPath = Path.join(this.props.repository.path, file.path)
        clipboard.writeText(fullPath)
      },
    }
  }

  private getRevealInFileManagerMenuItem = (
    file: WorkingDirectoryFileChange
  ): IMenuItem => {
    return {
      label: RevealInFileManagerLabel,
      action: () => revealInFileManager(this.props.repository, file.path),
      enabled: file.status.kind !== AppFileStatusKind.Deleted,
    }
  }

  private getOpenInExternalEditorMenuItem = (
    file: WorkingDirectoryFileChange,
    enabled: boolean
  ): IMenuItem => {
    const { externalEditorLabel, repository } = this.props

    const openInExternalEditor = externalEditorLabel
      ? `Open in ${externalEditorLabel}`
      : DefaultEditorLabel

    return {
      label: openInExternalEditor,
      action: () => {
        const fullPath = Path.join(repository.path, file.path)
        this.props.onOpenInExternalEditor(fullPath)
      },
      enabled,
    }
  }

  private getDefaultContextMenu(
    file: WorkingDirectoryFileChange
  ): ReadonlyArray<IMenuItem> {
    const { id, path, status } = file

    const extension = Path.extname(path)
    const isSafeExtension = isSafeFileExtension(extension)

    const { workingDirectory, selectedFileIDs } = this.props

    const selectedFiles = new Array<WorkingDirectoryFileChange>()
    const paths = new Array<string>()
    const extensions = new Set<string>()

    const addItemToArray = (fileID: string) => {
      const newFile = workingDirectory.findFileWithID(fileID)
      if (newFile) {
        selectedFiles.push(newFile)
        paths.push(newFile.path)

        const extension = Path.extname(newFile.path)
        if (extension.length) {
          extensions.add(extension)
        }
      }
    }

    if (selectedFileIDs.includes(id)) {
      // user has selected a file inside an existing selection
      // -> context menu entries should be applied to all selected files
      selectedFileIDs.forEach(addItemToArray)
    } else {
      // this is outside their previous selection
      // -> context menu entries should be applied to just this file
      addItemToArray(id)
    }

    const items: IMenuItem[] = [
      this.getDiscardChangesMenuItem(paths),
      { type: 'separator' },
    ]
    if (paths.length === 1) {
      items.push({
        label: __DARWIN__
          ? 'Ignore File (Add to .gitignore)'
          : 'Ignore file (add to .gitignore)',
        action: () => this.props.onIgnore(path),
        enabled: Path.basename(path) !== GitIgnoreFileName,
      })
    } else if (paths.length > 1) {
      items.push({
        label: __DARWIN__
          ? `Ignore ${paths.length} Selected Files (Add to .gitignore)`
          : `Ignore ${paths.length} selected files (add to .gitignore)`,
        action: () => {
          // Filter out any .gitignores that happens to be selected, ignoring
          // those doesn't make sense.
          this.props.onIgnore(
            paths.filter(path => Path.basename(path) !== GitIgnoreFileName)
          )
        },
        // Enable this action as long as there's something selected which isn't
        // a .gitignore file.
        enabled: paths.some(path => Path.basename(path) !== GitIgnoreFileName),
      })
    }
    // Five menu items should be enough for everyone
    Array.from(extensions)
      .slice(0, 5)
      .forEach(extension => {
        items.push({
          label: __DARWIN__
            ? `Ignore All ${extension} Files (Add to .gitignore)`
            : `Ignore all ${extension} files (add to .gitignore)`,
          action: () => this.props.onIgnore(`*${extension}`),
        })
      })

    const enabled = status.kind !== AppFileStatusKind.Deleted
    items.push(
      { type: 'separator' },
      this.getCopyPathMenuItem(file),
      this.getRevealInFileManagerMenuItem(file),
      this.getOpenInExternalEditorMenuItem(file, enabled),
      {
        label: OpenWithDefaultProgramLabel,
        action: () => this.props.onOpenItem(path),
        enabled: enabled && isSafeExtension,
      }
    )

    return items
  }

  private getRebaseContextMenu(
    file: WorkingDirectoryFileChange
  ): ReadonlyArray<IMenuItem> {
    const { path, status } = file

    const extension = Path.extname(path)
    const isSafeExtension = isSafeFileExtension(extension)

    const items = new Array<IMenuItem>()

    if (file.status.kind === AppFileStatusKind.Untracked) {
      items.push(this.getDiscardChangesMenuItem([file.path]), {
        type: 'separator',
      })
    }

    const enabled = status.kind !== AppFileStatusKind.Deleted

    items.push(
      this.getCopyPathMenuItem(file),
      this.getRevealInFileManagerMenuItem(file),
      this.getOpenInExternalEditorMenuItem(file, enabled),
      {
        label: OpenWithDefaultProgramLabel,
        action: () => this.props.onOpenItem(path),
        enabled: enabled && isSafeExtension,
      }
    )

    return items
  }

  private onItemContextMenu = (
    file: WorkingDirectoryFileChange,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    if (this.props.isCommitting) {
      return
    }

    event.preventDefault()

    const items =
      this.props.rebaseConflictState === null
        ? this.getDefaultContextMenu(file)
        : this.getRebaseContextMenu(file)

    showContextualMenu(items)
  }

  private getPlaceholderMessage(
    files: ReadonlyArray<WorkingDirectoryFileChange>,
    prepopulateCommitSummary: boolean
  ) {
    if (!prepopulateCommitSummary) {
      return 'Summary (required)'
    }

    const firstFile = files[0]
    const fileName = basename(firstFile.path)

    switch (firstFile.status.kind) {
      case AppFileStatusKind.New:
      case AppFileStatusKind.Untracked:
        return `Create ${fileName}`
      case AppFileStatusKind.Deleted:
        return `Delete ${fileName}`
      default:
        // TODO:
        // this doesn't feel like a great message for AppFileStatus.Copied or
        // AppFileStatus.Renamed but without more insight (and whether this
        // affects other parts of the flow) we can just default to this for now
        return `Update ${fileName}`
    }
  }

  private onScroll = (scrollTop: number, clientHeight: number) => {
    this.props.onChangesListScrolled(scrollTop)
  }

  private renderCommitMessageForm = (): JSX.Element => {
    const {
      rebaseConflictState,
      workingDirectory,
      repository,
      repositoryAccount,
      dispatcher,
      isCommitting,
      isAmending,
      currentBranchProtected,
    } = this.props

    if (rebaseConflictState !== null) {
      const hasUntrackedChanges = workingDirectory.files.some(
        f => f.status.kind === AppFileStatusKind.Untracked
      )

      return (
        <ContinueRebase
          dispatcher={dispatcher}
          repository={repository}
          rebaseConflictState={rebaseConflictState}
          workingDirectory={workingDirectory}
          isCommitting={isCommitting}
          hasUntrackedChanges={hasUntrackedChanges}
        />
      )
    }

    const fileCount = workingDirectory.files.length

    const includeAllValue = getIncludeAllValue(
      workingDirectory,
      rebaseConflictState
    )

    const anyFilesSelected =
      fileCount > 0 && includeAllValue !== CheckboxValue.Off

    const filesSelected = workingDirectory.files.filter(
      f => f.selection.getSelectionType() !== DiffSelectionType.None
    )

    // When a single file is selected, we use a default commit summary
    // based on the file name and change status.
    // However, for onboarding tutorial repositories, we don't want to do this.
    // See https://github.com/desktop/desktop/issues/8354
    const prepopulateCommitSummary =
      filesSelected.length === 1 && !repository.isTutorialRepository

    // if this is not a github repo, we don't want to
    // restrict what the user can do at all
    const hasWritePermissionForRepository =
      this.props.repository.gitHubRepository === null ||
      hasWritePermission(this.props.repository.gitHubRepository)

    return (
      <CommitMessage
        onCreateCommit={this.props.onCreateCommit}
        branch={this.props.branch}
        commitAuthor={this.props.commitAuthor}
        anyFilesSelected={anyFilesSelected}
        repository={repository}
        repositoryAccount={repositoryAccount}
        dispatcher={dispatcher}
        commitMessage={this.props.commitMessage}
        focusCommitMessage={this.props.focusCommitMessage}
        autocompletionProviders={this.props.autocompletionProviders}
        isCommitting={isCommitting}
        commitToAmend={isAmending ? this.props.mostRecentLocalCommit : null}
        showCoAuthoredBy={this.props.showCoAuthoredBy}
        coAuthors={this.props.coAuthors}
        placeholder={this.getPlaceholderMessage(
          filesSelected,
          prepopulateCommitSummary
        )}
        prepopulateCommitSummary={prepopulateCommitSummary}
        key={repository.id}
        showBranchProtected={fileCount > 0 && currentBranchProtected}
        showNoWriteAccess={fileCount > 0 && !hasWritePermissionForRepository}
        shouldNudge={this.props.shouldNudgeToCommit}
        commitSpellcheckEnabled={this.props.commitSpellcheckEnabled}
        persistCoAuthors={true}
        persistCommitMessage={true}
      />
    )
  }

  private onStashEntryClicked = () => {
    const { isShowingStashEntry, dispatcher, repository } = this.props

    if (isShowingStashEntry) {
      dispatcher.selectWorkingDirectoryFiles(repository)

      // If the button is clicked, that implies the stash was not restored or discarded
      dispatcher.recordNoActionTakenOnStash()
    } else {
      dispatcher.selectStashedFile(repository)
      dispatcher.recordStashView()
    }
  }

  private renderStashedChanges() {
    if (this.props.stashEntry === null) {
      return null
    }

    const className = classNames(
      'stashed-changes-button',
      this.props.isShowingStashEntry ? 'selected' : null
    )

    return (
      <button
        className={className}
        onClick={this.onStashEntryClicked}
        tabIndex={0}
        aria-selected={this.props.isShowingStashEntry}
      >
        <Octicon className="stack-icon" symbol={StashIcon} />
        <div className="text">Stashed Changes</div>
        <Octicon symbol={OcticonSymbol.chevronRight} />
      </button>
    )
  }

  private onRowKeyDown = (
    _row: number,
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    if (event.key === "/") {
      event.preventDefault()
      this.filterDiffTextBoxRef?.focus()
      this.filterDiffTextBoxRef?.selectAll()
      return
    }

    // The commit is already in-flight but this check prevents the
    // user from changing selection.
    if (
      this.props.isCommitting &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault()
    }

    return
  }

  private onFilterFieldKeyDown(evt: React.KeyboardEvent<HTMLInputElement>) {
    if (this.state.filteredFiles.length) {
      if (evt.key === "ArrowDown") {
        this.props.onFileSelectionChanged([this.state.filteredFiles[0]])
        this.listRef?.focus()
      } else if (evt.key === "ArrowUp") {
        this.props.onFileSelectionChanged([this.state.filteredFiles[this.state.filteredFiles.length - 1]])
        this.listRef?.focus()
      }
    }
  }

  public render() {
    const fileCount = this.props.workingDirectory.files.length
    const filesPlural = fileCount === 1 ? 'file' : 'files'
    const filesDescription = `${fileCount} changed ${filesPlural}`

    const selectedChangeCount = this.props.workingDirectory.files.filter(
      file => file.selection.getSelectionType() !== DiffSelectionType.None
    ).length
    const selectedFilesPlural = selectedChangeCount === 1 ? 'file' : 'files'
    const selectedChangesDescription = `${selectedChangeCount} changed ${selectedFilesPlural} selected`

    const includeAllValue = getIncludeAllValue(
      this.props.workingDirectory,
      this.props.rebaseConflictState
    )

    const disableAllCheckbox =
      fileCount === 0 ||
      this.props.isCommitting ||
      this.props.rebaseConflictState !== null

    return (
      <div className="changes-list-container file-list">
        <div
          className="header"
          onContextMenu={this.onContextMenu}
          title={selectedChangesDescription}
        >
          <Checkbox
            label={filesDescription}
            value={includeAllValue}
            onChange={this.onIncludeAllChanged}
            disabled={disableAllCheckbox}
          />
        </div>
        <div className="search-filter-form">
          <div className="form-field-keyboard-hint">
            <FancyTextBox
              symbol={OcticonSymbol.search}
              type="search"
              placeholder="Search contents"
              value={this.state.filterDiffText}
              disabled={false}
              onRef={ref => this.filterDiffTextBoxRef = ref}
              onValueChanged={v => {
                this.setState({ ...this.state, filterDiffText: v }, () => this.updateFilteredFiles())
              }}
              onKeyDown={k => this.onFilterFieldKeyDown(k)}
            />
            <div className="key-tile">/</div>
          </div>
          <FancyTextBox
            symbol={OcticonSymbol.filter}
            type="search"
            placeholder="Filter file paths"
            value={this.state.filterPathText}
            disabled={false}
            onRef={() => void 0}
            onValueChanged={v => {
              this.setState({ ...this.state, filterPathText: v }, () => this.updateFilteredFiles())
            }}
            onKeyDown={k => this.onFilterFieldKeyDown(k)}
          />
        </div>
        <List
          id="changes-list"
          rowCount={this.state.filteredFiles.length}
          rowHeight={RowHeight}
          rowRenderer={this.renderRow}
          selectedRows={this.getSelectedRows()}
          selectionMode="multi"
          onSelectionChanged={rows => this.props.onFileSelectionChanged(rows.map(r => this.state.filteredFiles[r]))}
          invalidationProps={{
            workingDirectory: this.props.workingDirectory,
            isCommitting: this.props.isCommitting,
          }}
          onRowClick={(row: number, source: ClickSource) => this.props.onRowClick?.(this.state.filteredFiles[row], source)}  // <List> actually calls this when you hit space on a row
          onScroll={this.onScroll}
          setScrollTop={this.props.changesListScrollTop}
          onRowKeyDown={this.onRowKeyDown}
          ref={ref => this.listRef = ref!}
        />
        {this.renderStashedChanges()}
        {this.renderCommitMessageForm()}
      </div>
    )
  }
}
