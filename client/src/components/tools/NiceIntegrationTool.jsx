import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { cn } from "@/lib/utils";
import {
  Link2,
  Server,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  KeyRound,
  Smartphone,
  Folder,
  FileText,
  ChevronRight,
} from "lucide-react";

function toneBadge(status) {
  // status: idle | connecting | connected | error
  if (status === "connected")
    return "border-green-200 bg-green-50 text-green-700";
  if (status === "connecting")
    return "border-amber-200 bg-amber-50 text-amber-900";
  if (status === "error") return "border-red-200 bg-red-50 text-red-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function formatDuo(codeDigits) {
  const s = String(codeDigits || "").replace(/\D/g, "");
  if (s.length === 6) return `${s.slice(0, 3)} ${s.slice(3)}`;
  return "••• •••";
}

function isDuoStage(stage) {
  return ["duo", "duo_code", "duo_trust"].includes(
    String(stage || "").toLowerCase(),
  );
}

function isDuoUrl(url) {
  return /duosecurity\.com\/frame\//i.test(String(url || ""));
}

function hasValidDuoCode(codeDigits) {
  const s = String(codeDigits || "").replace(/\D/g, "");
  return s.length === 6;
}

function safeEntryType(e) {
  const t = String(e?.type || e?.kind || "").toLowerCase();
  if (t.includes("folder") || t.includes("dir")) return "folder";
  if (t.includes("script") || t.includes("file")) return "script";
  // fallback: se vier sem type, tenta inferir pela flag
  if (e?.isFolder === true) return "folder";
  return "script";
}

export default function NiceIntegrationTool() {
  const [cluster, setCluster] = useState(null); // 1 | 2 | null
  const [status, setStatus] = useState("idle"); // idle | connecting | connected | error
  const [lastMsg, setLastMsg] = useState("");
  const [sessionInfo, setSessionInfo] = useState(null); // { sessionId?, startedAt?, cluster?, stage?, duoCode?, url? }

  // Modal (login/duo)
  const [authOpen, setAuthOpen] = useState(false);
  const [authStep, setAuthStep] = useState("login"); // login | duo
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Duo
  const [duoCode, setDuoCode] = useState(null);
  const [duoPending, setDuoPending] = useState(false);

  // Autenticação concluída (após Duo)
  const [authed, setAuthed] = useState(false);
  const duoFlowSeenRef = useRef(false);

  // Studio scripts explorer
  const [studioEnv, setStudioEnv] = useState(null); // "DEV" | "PRD" | null
  const [studioPath, setStudioPath] = useState([]); // ["ivr_bandalarga_pos", ...]
  const [studioItems, setStudioItems] = useState([]); // [{ name, type }]
  const [studioBusy, setStudioBusy] = useState(false);
  const [studioError, setStudioError] = useState("");

  const pollRef = useRef(null);

  const sid = sessionInfo?.sessionId || null;

  const statusLabel = useMemo(() => {
    if (status === "connected") return "Conectado";
    if (status === "connecting") return "Conectando…";
    if (status === "error") return "Erro";
    return "Aguardando";
  }, [status]);

  const startSession = useCallback(async (pickedCluster) => {
    setCluster(pickedCluster);
    setStatus("connecting");
    setLastMsg("");
    setSessionInfo(null);

    // reset auth modal state
    setAuthOpen(false);
    setAuthStep("login");
    setAuthBusy(false);
    setAuthError("");
    setUsername("");
    setPassword("");

    // reset duo state
    setDuoCode(null);
    setDuoPending(false);
    duoFlowSeenRef.current = false;

    // reset authed & studio
    setAuthed(false);
    setStudioEnv(null);
    setStudioPath([]);
    setStudioItems([]);
    setStudioBusy(false);
    setStudioError("");

    try {
      const r = await fetch("/api/nice/session/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ cluster: pickedCluster }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        const msg = j?.error || `Falha ao iniciar sessão (HTTP ${r.status})`;
        setStatus("error");
        setLastMsg(msg);
        return;
      }

      const nextSession = {
        sessionId: j.sessionId || null,
        startedAt: j.startedAt || new Date().toISOString(),
        cluster: pickedCluster,
        stage: j.stage || "unknown",
        duoCode: j.duoCode || null,
        url: j.url || null,
      };

      setStatus("connected");
      setSessionInfo(nextSession);
      setLastMsg(j?.message || "Sessão iniciada. Autentique para continuar.");

      const duoish = isDuoStage(nextSession.stage) || isDuoUrl(nextSession.url);

      if (duoish) {
        duoFlowSeenRef.current = true;
        setAuthStep("duo");
        setDuoCode(nextSession.duoCode || null);
        setDuoPending(!hasValidDuoCode(nextSession.duoCode));
      } else {
        setAuthStep("login");
      }

      setAuthOpen(true);
    } catch (e) {
      setStatus("error");
      setLastMsg(e?.message || String(e));
    }
  }, []);

  const stopSession = useCallback(async () => {
    setStatus("connecting");
    setLastMsg("");
    setAuthOpen(false);
    setAuthError("");
    setAuthBusy(false);

    try {
      const r = await fetch("/api/nice/session/stop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ sessionId: sid }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        const msg = j?.error || `Falha ao encerrar sessão (HTTP ${r.status})`;
        setStatus("error");
        setLastMsg(msg);
        return;
      }

      setStatus("idle");
      setSessionInfo(null);
      setLastMsg(j?.message || "Sessão encerrada.");
      setCluster(null);
      setUsername("");
      setPassword("");

      setDuoCode(null);
      setDuoPending(false);
      duoFlowSeenRef.current = false;

      setAuthed(false);
      setStudioEnv(null);
      setStudioPath([]);
      setStudioItems([]);
      setStudioBusy(false);
      setStudioError("");
    } catch (e) {
      setStatus("error");
      setLastMsg(e?.message || String(e));
    }
  }, [sid]);

  const fetchState = useCallback(async () => {
    if (!sid) return null;

    const r = await fetch(
      `/api/nice/session/state?sessionId=${encodeURIComponent(sid)}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      },
    );

    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return null;
    return j;
  }, [sid]);

  const loadStudioTree = useCallback(
    async ({ env, pathSegments }) => {
      if (!sid) return;
      const E = String(env || "").toUpperCase();
      if (!["DEV", "PRD"].includes(E)) return;

      const pathStr = (pathSegments || []).join("/");

      setStudioBusy(true);
      setStudioError("");

      try {
        const qs = new URLSearchParams({
          sessionId: sid,
          env: E,
          path: pathStr,
        });

        const r = await fetch(`/api/nice/studio/tree?${qs.toString()}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        const j = await r.json().catch(() => null);

        if (!r.ok || !j?.ok) {
          const msg =
            j?.error || `Falha ao buscar scripts (HTTP ${r.status || "?"})`;
          setStudioError(msg);
          setStudioItems([]);
          return;
        }

        const items = j.items || j.entries || j.nodes || [];
        setStudioItems(Array.isArray(items) ? items : []);
      } catch (e) {
        setStudioError(e?.message || String(e));
        setStudioItems([]);
      } finally {
        setStudioBusy(false);
      }
    },
    [sid],
  );

  const selectStudioEnv = useCallback(
    async (env) => {
      const E = String(env || "").toUpperCase();
      setStudioEnv(E);
      setStudioPath([]);
      setStudioItems([]);
      await loadStudioTree({ env: E, pathSegments: [] });
    },
    [loadStudioTree],
  );

  const openFolder = useCallback(
    async (name) => {
      const seg = String(name || "").trim();
      if (!seg) return;
      const nextPath = [...studioPath, seg];
      setStudioPath(nextPath);
      await loadStudioTree({ env: studioEnv, pathSegments: nextPath });
    },
    [loadStudioTree, studioEnv, studioPath],
  );

  const goBreadcrumb = useCallback(
    async (idx) => {
      // idx = -1 -> root "Scripts"
      // idx = 0..n -> path slice(0, idx+1)
      if (!studioEnv) return;

      if (idx < 0) {
        setStudioPath([]);
        await loadStudioTree({ env: studioEnv, pathSegments: [] });
        return;
      }

      const nextPath = studioPath.slice(0, idx + 1);
      setStudioPath(nextPath);
      await loadStudioTree({ env: studioEnv, pathSegments: nextPath });
    },
    [loadStudioTree, studioEnv, studioPath],
  );

  const doLogin = useCallback(async () => {
    if (!sid) {
      setAuthError("Sessão inválida. Inicie novamente.");
      return;
    }

    setAuthBusy(true);
    setAuthError("");

    try {
      const r = await fetch("/api/nice/session/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sessionId: sid,
          username,
          password,
        }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        const msg = j?.error || `Falha no login (HTTP ${r.status})`;
        setAuthError(msg);
        setAuthBusy(false);
        return;
      }

      // nunca manter senha após enviar
      setPassword("");

      const stage = j.stage || "unknown";
      const url = j.url || null;
      const code = j.duoCode || null;

      setSessionInfo((prev) => ({
        ...(prev || {}),
        stage,
        url,
        duoCode: code,
      }));

      const duoish = isDuoStage(stage) || isDuoUrl(url);

      // Se entrar no Duo: vai pro step "duo" e mostra o código (ou placeholder)
      if (duoish || !!code) {
        duoFlowSeenRef.current = true;

        setAuthStep("duo");
        setAuthOpen(true);

        setDuoCode(code);
        setDuoPending(!hasValidDuoCode(code));

        setLastMsg(j?.message || "Login enviado. Aguardando Duo…");
      } else {
        // já autenticou sem Duo
        setAuthOpen(false);
        setAuthed(true);
        setLastMsg(
          j?.message || "Autenticado. Selecione DEV/PRD para listar scripts.",
        );
      }

      setAuthBusy(false);
    } catch (e) {
      setAuthError(e?.message || String(e));
      setAuthBusy(false);
    }
  }, [password, sid, username]);

  // Poll enquanto estiver no step do Duo
  useEffect(() => {
    if (!authOpen || authStep !== "duo" || !sid) return;

    async function tick() {
      const st = await fetchState().catch(() => null);
      if (!st) return;

      const stage = st.stage || "unknown";
      const url = st.url || null;
      const code = st.duoCode || null;

      const duoish = isDuoStage(stage) || isDuoUrl(url);

      setSessionInfo((prev) => ({
        ...(prev || {}),
        stage,
        url,
        duoCode: code,
      }));

      // Continua no Duo: mostra placeholder se ainda não tem código
      if (duoish) {
        setDuoCode(code);
        setDuoPending(!hasValidDuoCode(code));
        return;
      }

      // Saiu do Duo => considera autenticado (apenas se realmente passou pelo Duo)
      if (duoFlowSeenRef.current) {
        setDuoPending(false);
        setAuthOpen(false);
        setAuthed(true);
        setLastMsg("Duo confirmado. Selecione DEV/PRD para listar scripts.");
      }
    }

    pollRef.current = window.setInterval(tick, 2500);
    tick();

    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [authOpen, authStep, fetchState, sid]);

  const healthBadge = (
    <Badge className={cn("border", toneBadge(status))}>{statusLabel}</Badge>
  );

  const showScriptsSection = status === "connected" && !!sid && authed;

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50">
                <Link2 className="h-4 w-4 text-zinc-800" />
              </span>

              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900">
                  Contact Center Claro • Integração NICE
                </div>
                <div className="mt-0.5 text-xs text-zinc-600">
                  Fluxo: Front-end → Back-end → Serviço Puppeteer.
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
              <span className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1">
                <Server className="h-4 w-4" />
                Endpoint esperado:{" "}
                <span className="font-mono">/api/nice/*</span>
              </span>
              <span className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1">
                <ShieldCheck className="h-4 w-4" />
                Credenciais: somente no fluxo (não persistir no front)
              </span>
            </div>
          </div>

          {healthBadge}
        </div>

        {lastMsg ? (
          <div
            className={cn(
              "mt-3 rounded-xl border px-3 py-2 text-sm",
              status === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-zinc-200 bg-zinc-50 text-zinc-700",
            )}
          >
            <div className="flex items-start gap-2">
              {status === "error" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4" />
              ) : (
                <RefreshCw className="mt-0.5 h-4 w-4" />
              )}
              <div className="min-w-0">{lastMsg}</div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Seleção de cluster */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-900">
              Escolha o Contact Center
            </div>
            <div className="mt-1 text-xs text-zinc-600">
              O backend iniciará a sessão no cluster selecionado (1 ou 2).
            </div>
          </div>

          {sessionInfo?.cluster ? (
            <span className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-700">
              Selecionado: <b>Cluster {sessionInfo.cluster}</b>
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant={cluster === 1 ? "default" : "outline"}
            className={cn(
              "h-11 rounded-xl justify-between",
              cluster === 1
                ? "bg-red-600 text-white hover:bg-red-700"
                : "border-zinc-200 bg-white",
            )}
            onClick={() => startSession(1)}
            disabled={status === "connecting"}
          >
            <span>CONTACT CENTER 1</span>
            <span
              className={cn(
                "text-xs",
                cluster === 1 ? "text-white/90" : "text-zinc-500",
              )}
            >
              Cluster 1
            </span>
          </Button>

          <Button
            type="button"
            variant={cluster === 2 ? "default" : "outline"}
            className={cn(
              "h-11 rounded-xl justify-between",
              cluster === 2
                ? "bg-red-600 text-white hover:bg-red-700"
                : "border-zinc-200 bg-white",
            )}
            onClick={() => startSession(2)}
            disabled={status === "connecting"}
          >
            <span>CONTACT CENTER 2</span>
            <span
              className={cn(
                "text-xs",
                cluster === 2 ? "text-white/90" : "text-zinc-500",
              )}
            >
              Cluster 2
            </span>
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-zinc-500">
            Observação: acesso pode ser bloqueado em mobile (regra do próprio
            portal).
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-zinc-200 bg-white"
              onClick={() => {
                if (sid) {
                  setAuthError("");
                  setAuthBusy(false);
                  setAuthOpen(true);

                  const duoish =
                    isDuoStage(sessionInfo?.stage) ||
                    isDuoUrl(sessionInfo?.url);

                  setAuthStep(duoish ? "duo" : "login");
                  setDuoCode(sessionInfo?.duoCode || duoCode || null);
                  setDuoPending(
                    duoish && !hasValidDuoCode(sessionInfo?.duoCode),
                  );
                }
              }}
              disabled={!sid || status !== "connected"}
              title="Abrir autenticação"
            >
              Autenticar
            </Button>

            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-zinc-200 bg-white"
              onClick={stopSession}
              disabled={status !== "connected"}
              title="Encerrar sessão do Puppeteer"
            >
              Encerrar sessão
            </Button>
          </div>
        </div>
      </div>

      {/* Scripts (após Duo) */}
      {showScriptsSection ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-zinc-900">
                Scripts • Studio NICE
              </div>
              <div className="mt-1 text-xs text-zinc-600">
                Selecione DEV/PRD para listar pastas e scripts.
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant={studioEnv === "DEV" ? "default" : "outline"}
                className={cn(
                  "rounded-xl",
                  studioEnv === "DEV"
                    ? "bg-zinc-900 text-white hover:bg-zinc-800"
                    : "border-zinc-200 bg-white",
                )}
                onClick={() => selectStudioEnv("DEV")}
                disabled={studioBusy}
              >
                DEV
              </Button>

              <Button
                type="button"
                variant={studioEnv === "PRD" ? "default" : "outline"}
                className={cn(
                  "rounded-xl",
                  studioEnv === "PRD"
                    ? "bg-zinc-900 text-white hover:bg-zinc-800"
                    : "border-zinc-200 bg-white",
                )}
                onClick={() => selectStudioEnv("PRD")}
                disabled={studioBusy}
              >
                PRD
              </Button>
            </div>
          </div>

          {/* Breadcrumb: Scripts -> PRD -> pasta */}
          <div className="mt-4 flex flex-wrap items-center gap-1 text-xs text-zinc-600">
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 hover:bg-zinc-100"
              onClick={() => goBreadcrumb(-1)}
              disabled={!studioEnv || studioBusy}
              title="Voltar ao início"
            >
              Scripts
            </button>

            <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />

            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 hover:bg-zinc-100"
              onClick={() => {
                if (!studioEnv) return;
                goBreadcrumb(-1);
              }}
              disabled={!studioEnv || studioBusy}
              title="Voltar para o root do ambiente"
            >
              {studioEnv || "—"}
            </button>

            {studioPath.map((seg, idx) => (
              <React.Fragment key={`${seg}-${idx}`}>
                <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
                <button
                  type="button"
                  className="rounded-md px-1.5 py-0.5 hover:bg-zinc-100"
                  onClick={() => goBreadcrumb(idx)}
                  disabled={!studioEnv || studioBusy}
                  title="Abrir este nível"
                >
                  {seg}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Lista */}
          <div className="mt-3 rounded-2xl border border-zinc-200 bg-white">
            <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Itens
              </div>

              {studioBusy ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Carregando…
                </div>
              ) : null}
            </div>

            {studioError ? (
              <div className="px-3 py-3 text-sm text-red-700">
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                  {studioError}
                </div>
              </div>
            ) : null}

            {!studioEnv ? (
              <div className="px-3 py-4 text-sm text-zinc-600">
                Selecione <b>DEV</b> ou <b>PRD</b> para carregar a lista.
              </div>
            ) : studioItems?.length ? (
              <div className="divide-y divide-zinc-100">
                {studioItems.map((it, idx) => {
                  const name =
                    it?.name || it?.title || it?.label || `item-${idx}`;
                  const type = safeEntryType(it);
                  const isFolder = type === "folder";

                  return (
                    <button
                      key={`${name}-${idx}`}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-50",
                        studioBusy ? "opacity-60" : "",
                      )}
                      onClick={() => {
                        if (studioBusy) return;
                        if (isFolder) return openFolder(name);
                        // script (futuro: abrir/baixar/exibir)
                        setLastMsg(`Selecionado script: ${name}`);
                      }}
                      disabled={studioBusy}
                      title={isFolder ? "Abrir pasta" : "Selecionar script"}
                    >
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50">
                        {isFolder ? (
                          <Folder className="h-4 w-4 text-zinc-800" />
                        ) : (
                          <FileText className="h-4 w-4 text-zinc-800" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-zinc-900">
                          {name}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {isFolder ? "Pasta" : "Script"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-3 py-4 text-sm text-zinc-600">
                {studioBusy
                  ? "Carregando…"
                  : "Nenhum item encontrado neste caminho."}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Debug/Info */}
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Dados da sessão
        </div>
        <pre className="mt-2 overflow-auto rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-800">
          {JSON.stringify(
            {
              status,
              cluster,
              sessionInfo,
              duoPending,
              authed,
              studioEnv,
              studioPath,
              studioItemsCount: studioItems?.length || 0,
            },
            null,
            2,
          )}
        </pre>
      </div>

      {/* Modal de autenticação */}
      <Dialog open={authOpen} onOpenChange={(v) => setAuthOpen(v)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {authStep === "login" ? (
                <>
                  <KeyRound className="h-4 w-4" /> Login
                </>
              ) : (
                <>
                  <Smartphone className="h-4 w-4" /> Duo Mobile
                </>
              )}
            </DialogTitle>

            <DialogDescription>
              {authStep === "login"
                ? "Informe usuário e senha e clique em OK para iniciar a sessão."
                : duoPending
                  ? "Aguardando o portal carregar o código do Duo…"
                  : "Abra o Duo Mobile e digite o número exibido no navegador."}
            </DialogDescription>
          </DialogHeader>

          {authStep === "login" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="nice-username">Usuário</Label>
                <Input
                  id="nice-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="Seu usuário"
                  disabled={authBusy}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nice-password">Senha</Label>
                <Input
                  id="nice-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Sua senha"
                  disabled={authBusy}
                />
              </div>

              {authError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {authError}
                </div>
              ) : null}

              {authBusy ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Enviando credenciais…
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Sempre mostra o bloco do número; se não tiver código, fica ••• ••• */}
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-center">
                {duoPending ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-zinc-700">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Carregando código do Duo…
                  </div>
                ) : (
                  <div className="text-xs text-zinc-600">Número do Duo</div>
                )}

                <div className="mt-2 text-4xl font-semibold tracking-widest text-zinc-900">
                  {formatDuo(duoCode)}
                </div>

                <div className="mt-2 text-xs text-zinc-600">
                  A tela deve recarregar automaticamente após a confirmação.
                </div>

                <div className="mt-3 text-[11px] text-zinc-500">
                  Stage: <span className="font-mono">{sessionInfo?.stage}</span>
                </div>
              </div>

              {authError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {authError}
                </div>
              ) : (
                <div className="text-xs text-zinc-500">
                  Monitorando estado… (poll a cada ~2,5s)
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setAuthOpen(false)}
              disabled={authBusy}
            >
              Fechar
            </Button>

            {authStep === "login" ? (
              <Button
                type="button"
                className="rounded-xl bg-red-600 text-white hover:bg-red-700"
                onClick={doLogin}
                disabled={authBusy || !sid}
              >
                {authBusy ? (
                  <span className="inline-flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Enviando…
                  </span>
                ) : (
                  "OK"
                )}
              </Button>
            ) : (
              <Button
                type="button"
                className="rounded-xl bg-red-600 text-white hover:bg-red-700"
                onClick={async () => {
                  setAuthBusy(true);
                  setAuthError("");
                  try {
                    const st = await fetchState();
                    if (!st) throw new Error("Falha ao consultar estado.");

                    const stage = st.stage || "unknown";
                    const url = st.url || null;
                    const code = st.duoCode || null;
                    const duoish = isDuoStage(stage) || isDuoUrl(url);

                    setSessionInfo((prev) => ({
                      ...(prev || {}),
                      stage,
                      url,
                      duoCode: code,
                    }));

                    if (duoish) {
                      setDuoCode(code);
                      setDuoPending(!hasValidDuoCode(code));
                    }
                  } catch (e) {
                    setAuthError(e?.message || String(e));
                  } finally {
                    setAuthBusy(false);
                  }
                }}
                disabled={authBusy || !sid}
              >
                {authBusy ? (
                  <span className="inline-flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Atualizando…
                  </span>
                ) : (
                  "Atualizar"
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
