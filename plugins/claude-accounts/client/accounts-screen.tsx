import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text } from "react-native";
import {
  useRpc,
  useSettings,
  type PluginScreenProps,
  type SettingsState,
} from "@getpaseo/plugin/client";
import {
  Modal,
  ScrollView,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  type SettingsInputHandle,
} from "@getpaseo/plugin/client/ui";
import {
  addAccountRpc,
  listAccountsRpc,
  moveIdleRpc,
  removeAccountRpc,
  signInRpc,
  type Account,
  type ActionResult,
} from "../shared/rpc.js";
import { claudeAccountsSettings } from "../shared/settings.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";
import {
  MOVE_CONFIRM_MS,
  accountLabel,
  canRemove,
  defaultAccountOptions,
  defaultAfterRemoval,
  describeAccount,
  describeMoveJob,
  moveActionLabel,
  moveHint,
  moveTargetOptions,
  nameError,
  needsSignIn,
  removalNotes,
} from "./view-model.js";

const ACCOUNTS_KEY = ["claude-accounts", "list"] as const;
const POLL_MS = 5_000;
const DEFAULT_HINT =
  "Auto picks the signed-in account with the most room and known usage, skipping any at 95% or more or on pace to run out within 30 minutes. Agents started on a specific account stay on it.";
const INVALID_DEFAULT_HINT = "New agents start on the main account until you reset this";
const SIGN_IN_HINT = "Opens claude auth login in a terminal of your most recent workspace";
const NAME_HINT = "Lowercase letters, digits and dashes, such as work";
const ADD_HINT = "Creates the account's directory and provider, then opens its sign-in terminal";
const NO_TARGET_HINT = "No other signed-in account can take agents";
const REMOVE_HINT = "Deletes its provider and moves its folder aside, with its history and login";

type AccountsSettings = SettingsState<typeof claudeAccountsSettings.schema>;

type OpenWorkspace = (workspaceId: string) => void;

interface Reply {
  ok: boolean;
  error: string | null;
}

interface DefaultAccountProps {
  accounts: readonly Account[];
  settings: AccountsSettings;
  styles: ScreenStyles;
}

interface AccountCardProps {
  account: Account;
  accounts: readonly Account[];
  jobRunning: boolean;
  openWorkspace: OpenWorkspace;
  onRemoved: (provider: string) => void;
  styles: ScreenStyles;
}

interface RemoveAccountActionProps {
  account: Account;
  onRemoved: (provider: string) => void;
  styles: ScreenStyles;
}

interface SignInActionProps {
  account: Account;
  openWorkspace: OpenWorkspace;
}

interface MoveIdleActionProps {
  account: Account;
  accounts: readonly Account[];
  jobRunning: boolean;
}

interface AddAccountProps {
  openWorkspace: OpenWorkspace;
}

// A thrown RPC error, or the refusal the handler returned.
function actionError(error: Error | null, reply: Reply | undefined): string | null {
  if (error !== null) return error.message;
  return reply?.ok === false ? reply.error : null;
}

// The sign-in terminal runs in a workspace; show it so the user can finish the login there.
function followLogin(result: ActionResult, openWorkspace: OpenWorkspace): void {
  if (result.loginWorkspaceId !== null) openWorkspace(result.loginWorkspaceId);
}

// The screen owns the settings, so a reset after Remove shows its error under this picker.
function DefaultAccount({ accounts, settings, styles }: DefaultAccountProps) {
  const saved = settings.status === "ready" ? settings.values.defaultAccount : null;
  const options = useMemo(() => defaultAccountOptions(accounts, saved), [accounts, saved]);
  const change = useCallback(
    (defaultAccount: string) => {
      if (settings.status !== "ready") return;
      void settings.save({ ...settings.values, defaultAccount }, settings.revision);
    },
    [settings],
  );
  const reset = useCallback(() => {
    void settings.reset();
  }, [settings]);
  if (settings.status === "ready") {
    return (
      <SettingsSelect
        testID="claude-accounts-default"
        label="New Claude agents"
        hint={DEFAULT_HINT}
        error={settings.saveError}
        value={settings.values.defaultAccount}
        options={options}
        disabled={settings.saving}
        onValueChange={change}
      />
    );
  }
  if (settings.status === "loading") {
    return <Text style={styles.muted}>Loading the default account...</Text>;
  }
  if (settings.status === "error") {
    return (
      <SettingsAction
        label="New Claude agents"
        error={settings.error}
        actionLabel="Reload"
        onPress={settings.reload}
      />
    );
  }
  return (
    <SettingsAction
      label="New Claude agents"
      hint={INVALID_DEFAULT_HINT}
      error={settings.saveError ?? settings.error}
      actionLabel={settings.saving ? "Resetting..." : "Reset"}
      disabled={settings.saving}
      onPress={reset}
    />
  );
}

function SignInAction({ account, openWorkspace }: SignInActionProps) {
  const callSignIn = useRpc(signInRpc);
  const queryClient = useQueryClient();
  const signIn = useMutation({
    mutationFn: () => callSignIn({ provider: account.provider }),
    onSuccess: (result: ActionResult) => followLogin(result, openWorkspace),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
  });
  const { mutate } = signIn;
  const press = useCallback(() => mutate(), [mutate]);
  return (
    <SettingsAction
      testID={`claude-accounts-sign-in-${account.provider}`}
      label={account.loginExpired ? "Login expired" : "Not signed in"}
      hint={SIGN_IN_HINT}
      error={actionError(signIn.error, signIn.data)}
      actionLabel={signIn.isPending ? "Opening..." : "Sign in"}
      disabled={signIn.isPending}
      onPress={press}
    />
  );
}

function MoveIdleAction({ account, accounts, jobRunning }: MoveIdleActionProps) {
  const targets = useMemo(
    () => moveTargetOptions(accounts, account.provider),
    [accounts, account.provider],
  );
  const [picked, setPicked] = useState<string | null>(null);
  // The first press arms the move; the timer, another target, an unmount or the move disarms it.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), MOVE_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  const callMove = useRpc(moveIdleRpc);
  const queryClient = useQueryClient();
  const move = useMutation({
    mutationFn: (target: string) => callMove({ from: account.provider, to: target }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
  });
  const to = targets.find((option) => option.value === picked)?.value ?? targets[0]?.value ?? null;
  const pick = useCallback((value: string) => {
    setPicked(value);
    setArmed(false);
  }, []);
  const { mutate } = move;
  const press = useCallback(() => {
    if (to === null) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    mutate(to);
  }, [armed, mutate, to]);
  const testID = `claude-accounts-move-${account.provider}`;
  if (to === null) {
    return <SettingsRow testID={testID} label="Move idle agents" hint={NO_TARGET_HINT} />;
  }
  const idle = account.agents.total - account.agents.busy;
  const blocked = idle === 0 || jobRunning || move.isPending;
  const hint = moveHint({
    idle,
    jobRunning,
    armed,
    from: account.label,
    to: accountLabel(accounts, to),
  });
  return (
    <>
      <SettingsSelect
        testID={`claude-accounts-move-target-${account.provider}`}
        label="Move idle agents to"
        value={to}
        options={targets}
        disabled={blocked}
        onValueChange={pick}
      />
      <SettingsAction
        testID={testID}
        label="Move idle agents"
        hint={hint}
        error={actionError(move.error, move.data)}
        actionLabel={moveActionLabel(move.isPending, armed)}
        disabled={blocked}
        onPress={press}
      />
    </>
  );
}

function RemoveAccountAction({ account, onRemoved, styles }: RemoveAccountActionProps) {
  const [open, setOpen] = useState(false);
  const callRemove = useRpc(removeAccountRpc);
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => callRemove({ provider: account.provider }),
    // A refusal keeps the dialog open with its reason.
    onSuccess: (result: ActionResult) => {
      if (!result.ok) return;
      setOpen(false);
      onRemoved(account.provider);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
  });
  const { mutate, reset } = remove;
  const openDialog = useCallback(() => {
    reset();
    setOpen(true);
  }, [reset]);
  const confirm = useCallback(() => mutate(), [mutate]);
  return (
    <>
      <SettingsAction
        testID={`claude-accounts-remove-${account.provider}`}
        label="Remove account"
        hint={REMOVE_HINT}
        actionLabel="Remove"
        onPress={openDialog}
      />
      <Modal title={`Remove ${account.label}`} open={open} onOpenChange={setOpen}>
        <Modal.Content>
          {removalNotes(account).map((note) => (
            <Text key={note} style={styles.text}>
              {note}
            </Text>
          ))}
          <SettingsAction
            testID={`claude-accounts-remove-confirm-${account.provider}`}
            label={`Remove ${account.label}`}
            error={actionError(remove.error, remove.data)}
            actionLabel={remove.isPending ? "Removing..." : "Remove"}
            disabled={remove.isPending}
            onPress={confirm}
          />
        </Modal.Content>
      </Modal>
    </>
  );
}

function AccountCard({
  account,
  accounts,
  jobRunning,
  openWorkspace,
  onRemoved,
  styles,
}: AccountCardProps) {
  const problems = account.problems.length === 0 ? null : account.problems.join("\n");
  return (
    <SettingsCard>
      <SettingsRow
        testID={`claude-accounts-row-${account.provider}`}
        label={account.label}
        hint={describeAccount(account)}
        error={problems}
      />
      {needsSignIn(account) ? (
        <SignInAction account={account} openWorkspace={openWorkspace} />
      ) : null}
      {account.agents.total > 0 ? (
        <MoveIdleAction account={account} accounts={accounts} jobRunning={jobRunning} />
      ) : null}
      {canRemove(account) ? (
        <RemoveAccountAction account={account} onRemoved={onRemoved} styles={styles} />
      ) : null}
    </SettingsCard>
  );
}

function AddAccount({ openWorkspace }: AddAccountProps) {
  const input = useRef<SettingsInputHandle>(null);
  const [name, setName] = useState("");
  const callAdd = useRpc(addAccountRpc);
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: (accountName: string) => callAdd({ name: accountName }),
    onSuccess: (result: ActionResult) => {
      // A failed sign-in terminal keeps the name, so pressing Add again retries it.
      if (result.ok) {
        input.current?.replaceText("");
        setName("");
      }
      followLogin(result, openWorkspace);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
  });
  const { mutate } = add;
  const invalid = nameError(name);
  const canAdd = name !== "" && invalid === null && !add.isPending;
  const press = useCallback(() => {
    if (name !== "" && nameError(name) === null) mutate(name);
  }, [mutate, name]);
  return (
    <SettingsSection title="Add account">
      <SettingsCard>
        <SettingsInput
          ref={input}
          testID="claude-accounts-name"
          label="Name"
          hint={NAME_HINT}
          error={invalid}
          placeholder="work"
          disabled={add.isPending}
          onChangeText={setName}
        />
        <SettingsAction
          testID="claude-accounts-add"
          label="Add account"
          hint={ADD_HINT}
          error={actionError(add.error, add.data)}
          actionLabel={add.isPending ? "Adding..." : "Add"}
          disabled={!canAdd}
          onPress={press}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

export function AccountsScreen({ theme, navigation }: PluginScreenProps) {
  const styles = useScreenStyles(theme);
  const settings = useSettings(claudeAccountsSettings);
  const listAccounts = useRpc(listAccountsRpc);
  // The interval belongs to the query observer, so polling stops when the screen unmounts. Retries
  // are off: a failed fetch shows at once, and the next poll is the retry.
  const list = useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => listAccounts({}),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const navigate = navigation?.openWorkspace;
  const openWorkspace = useCallback(
    (workspaceId: string) => navigate?.({ workspaceId }),
    [navigate],
  );
  // A save that fails shows under the default account picker; the removal stays done, and a
  // default naming a gone account starts agents on plain claude.
  const resetDefault = useCallback(
    (removed: string) => {
      if (settings.status !== "ready") return;
      const next = defaultAfterRemoval(settings.values.defaultAccount, removed);
      if (next === null) return;
      void settings.save({ ...settings.values, defaultAccount: next }, settings.revision);
    },
    [settings],
  );
  const { refetch } = list;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const { data } = list;
  if (data === undefined) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        {list.isError ? (
          <SettingsAction
            label="Claude accounts"
            error={list.error.message}
            actionLabel="Try again"
            onPress={retry}
          />
        ) : (
          <Text style={styles.muted}>Loading accounts...</Text>
        )}
      </ScrollView>
    );
  }
  const jobRunning = data.moveJob !== null && !data.moveJob.done;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SettingsSection title="Default account">
        <SettingsCard>
          <DefaultAccount accounts={data.accounts} settings={settings} styles={styles} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Accounts">
        {list.isError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {`Refresh failed: ${list.error.message}`}
          </Text>
        ) : null}
        {data.usageError === null ? null : <Text style={styles.warning}>{data.usageError}</Text>}
        {data.moveJob === null ? null : (
          <Text style={styles.muted}>{describeMoveJob(data.moveJob, data.accounts)}</Text>
        )}
        {data.accounts.map((account) => (
          <AccountCard
            key={account.provider}
            account={account}
            accounts={data.accounts}
            jobRunning={jobRunning}
            openWorkspace={openWorkspace}
            onRemoved={resetDefault}
            styles={styles}
          />
        ))}
      </SettingsSection>
      <AddAccount openWorkspace={openWorkspace} />
    </ScrollView>
  );
}
