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
  if (!s) return "••• •••";
  return s;
}

function isDuoStage(stage) {
  return ["duo", "duo_code", "duo_trust"].includes(
    String(stage || "").toLowerCase(),
  );
}

export default function NiceIntegrationTool() {
  const [cluster, setCluster] = useState(null); // 1 | 2 | null
  const [status, setStatus] = useState("idle"); // idle | connecting | connected | error
  const [lastMsg, setLastMsg] = useState("");
  const [sessionInfo, setSessionInfo] = useState(null); // { sessionId?, startedAt?, cluster?, stage?, duoCode? }

  // Modal (login/duo)
  const [authOpen, setAuthOpen] = useState(false);
  const [authStep, setAuthStep] = useState("login"); // login | duo
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [duoCode, setDuoCode] = useState(null);

  const pollRef = useRef(null);

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
    setDuoCode(null);

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
      };

      setStatus("connected");
      setSessionInfo(nextSession);
      setLastMsg(j?.message || "Sessão iniciada. Autentique para continuar.");

      // abre modal no passo adequado
      if (isDuoStage(nextSession.stage)) {
        setAuthStep("duo");
        setDuoCode(nextSession.duoCode || null);
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
        body: JSON.stringify({ sessionId: sessionInfo?.sessionId || null }),
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
    } catch (e) {
      setStatus("error");
      setLastMsg(e?.message || String(e));
    }
  }, [sessionInfo?.sessionId]);

  const fetchState = useCallback(async () => {
    const sid = sessionInfo?.sessionId;
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
  }, [sessionInfo?.sessionId]);

  const doLogin = useCallback(async () => {
    const sid = sessionInfo?.sessionId;
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
      const next = {
        ...(sessionInfo || {}),
        stage,
        duoCode: j.duoCode || null,
      };
      setSessionInfo(next);

      const isDuoByUrl = /duosecurity\.com\/frame\//i.test(j?.url || "");
      const shouldShowDuo = isDuoStage(stage) || isDuoByUrl || !!j?.duoCode;

      if (shouldShowDuo) {
        setDuoCode(j.duoCode || null);
        setAuthStep("duo");
        setAuthOpen(true);
        setLastMsg(j?.message || "Login enviado. Aguardando Duo…");
      } else {
        setAuthOpen(false);
        setLastMsg(j?.message || "Login enviado.");
      }

      setAuthBusy(false);
    } catch (e) {
      setAuthError(e?.message || String(e));
      setAuthBusy(false);
    }
  }, [password, sessionInfo, username]);

  // Poll enquanto estiver no step do Duo
  useEffect(() => {
    if (!authOpen || authStep !== "duo" || !sessionInfo?.sessionId) return;

    async function tick() {
      const st = await fetchState().catch(() => null);
      if (!st) return;

      const next = {
        ...(sessionInfo || {}),
        stage: st.stage,
        duoCode: st.duoCode || null,
      };
      setSessionInfo(next);

      if (isDuoStage(st.stage)) {
        if (st.duoCode) setDuoCode(st.duoCode);
        return;
      }

      // quando sair do duo...
      setAuthOpen(false);
      setLastMsg("Duo confirmado. Página recarregada/fluxo avançado.");
    }

    pollRef.current = window.setInterval(tick, 2500);
    tick();

    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [authOpen, authStep, fetchState, sessionInfo?.sessionId]);

  const healthBadge = (
    <Badge className={cn("border", toneBadge(status))}>{statusLabel}</Badge>
  );

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
                if (sessionInfo?.sessionId) {
                  setAuthError("");
                  setAuthBusy(false);
                  setAuthOpen(true);
                  setAuthStep(isDuoStage(sessionInfo?.stage) ? "duo" : "login");
                  setDuoCode(sessionInfo?.duoCode || duoCode || null);
                }
              }}
              disabled={!sessionInfo?.sessionId || status !== "connected"}
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
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-center">
                <div className="text-xs text-zinc-600">Número do Duo</div>
                <div className="mt-2 text-4xl font-semibold tracking-widest text-zinc-900">
                  {formatDuo(duoCode)}
                </div>
                <div className="mt-2 text-xs text-zinc-600">
                  A tela deve recarregar automaticamente após a confirmação.
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
                disabled={authBusy || !sessionInfo?.sessionId}
              >
                OK
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
                    setSessionInfo((prev) => ({
                      ...(prev || {}),
                      stage: st.stage,
                      duoCode: st.duoCode || null,
                    }));
                    if (st.stage === "duo" && st.duoCode)
                      setDuoCode(st.duoCode);
                  } catch (e) {
                    setAuthError(e?.message || String(e));
                  } finally {
                    setAuthBusy(false);
                  }
                }}
                disabled={authBusy || !sessionInfo?.sessionId}
              >
                Atualizar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
