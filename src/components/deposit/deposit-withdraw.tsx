'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '../ui/Card';
import { usePositions } from '@/hooks/usePositions';
import { SelectTokenModal } from './select-token-modal';
import { DepositModal } from './DepositModal/review-deposit-modal';
import { ReviewWithdrawModal } from '../WithdrawModal/review-withdraw-modal';

import { useWalletClient } from 'wagmi';
import { parseUnits } from 'viem';

import type { YieldSnapshot } from '@/hooks/useYields';

// parity helpers
import { getBridgeQuote, quoteUsdceOnLisk } from '@/lib/quotes';
import { TokenAddresses, getDualBalances } from '@/lib/constants';
import {
  readWalletBalance,
  symbolForWalletDisplay,
  tokenAddrFor,
} from './helpers';

type EvmChain = 'optimism' | 'base' | 'lisk';

interface Token {
  id: 'usdc' | 'usdt';
  name: 'USD Coin' | 'Tether USD';
  symbol: 'USDC' | 'USDT';
  icon: string;
  balance: number;
  address: string;
}

interface DepositWithdrawProps {
  initialTab?: 'deposit' | 'withdraw';
  /** Morpho Lisk snapshot (USDC/USDT). */
  snap?: YieldSnapshot;
}

// minimal humanizer
function formatAmountBigint(n: bigint, decimals: number): string {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;

  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (frac === 0n) return `${neg ? '-' : ''}${wholeStr}`;

  let fracStr = frac.toString().padStart(decimals, '0');
  fracStr = fracStr.slice(0, Math.min(6, fracStr.length)).replace(/0+$/, '');
  return `${neg ? '-' : ''}${wholeStr}${fracStr ? '.' + fracStr : ''}`;
}

function toLiskDestLabel(src: YieldSnapshot['token'] | 'USDC' | 'USDT' | 'WETH'): 'USDCe' | 'USDT0' | 'WETH' {
  if (src === 'USDC') return 'USDCe';
  if (src === 'USDT') return 'USDT0';
  return 'WETH';
}

export function DepositWithdraw({ initialTab = 'deposit', snap }: DepositWithdrawProps) {
  const { data: walletClient } = useWalletClient();

  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>(initialTab);
  const [amount, setAmount] = useState('');

  // selector – safe default first, sync once snap arrives
  const [selectedToken, setSelectedToken] = useState<Token>({
    id: 'usdc',
    name: 'USD Coin',
    symbol: 'USDC',
    icon: '/tokens/usdc-icon.png',
    balance: 0,
    address: '0x0000...0000',
  });

  const [showTokenModal, setShowTokenModal] = useState(false);
  const [showReview, setShowReview] = useState(false);

  // withdraw review modal + destination (you can expose a picker later)
  const [showWithdrawReview, setShowWithdrawReview] = useState(false);
  const [withdrawDest, setWithdrawDest] = useState<'lisk' | 'optimism' | 'base'>('optimism');

  // balances (for quotes and modal decisions)
  const [availableTokenBalances, setAvailableTokenBalances] = useState<{ USDC: number; USDT: number }>({
    USDC: 0,
    USDT: 0,
  });

  const [opBal, setOpBal] = useState<bigint | null>(null);
  const [baBal, setBaBal] = useState<bigint | null>(null);
  const [liBal, setLiBal] = useState<bigint | null>(null);
  const [liBalUSDT0, setLiBalUSDT0] = useState<bigint | null>(null);
  const [opUsdcBal, setOpUsdcBal] = useState<bigint | null>(null);
  const [baUsdcBal, setBaUsdcBal] = useState<bigint | null>(null);
  const [opUsdtBal, setOpUsdtBal] = useState<bigint | null>(null);
  const [baUsdtBal, setBaUsdtBal] = useState<bigint | null>(null);

  // quote state (deposit side)
  const [route, setRoute] = useState<string | null>(null);
  const [fee, setFee] = useState<bigint>(0n);
  const [received, setReceived] = useState<bigint>(0n);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // derive
  const vaultToken: 'USDC' | 'USDT' | 'WETH' = (snap?.token as any) ?? 'USDC';
  const tokenDecimals = vaultToken === 'WETH' ? 18 : 6;
  const destTokenLabel = toLiskDestLabel(vaultToken);
  const isUsdtFamily = vaultToken === 'USDT' || destTokenLabel === 'USDT0';

  // positions for withdraw tab balance
  const { data: positionsRaw } = usePositions();
  const positions = (positionsRaw ?? []) as Array<{
    protocol: string;
    chain: 'lisk' | string;
    token: 'USDCe' | 'USDT0' | 'WETH' | string;
    amount: bigint;
  }>;

  const morphoTokenOnLisk: 'USDCe' | 'USDT0' | 'WETH' = destTokenLabel;
  const withdrawPosition = useMemo(
    () =>
      positions.find(
        (p) =>
          p.protocol === 'Morpho Blue' &&
          p.chain === 'lisk' &&
          (p.token as any) === morphoTokenOnLisk
      ),
    [positions, morphoTokenOnLisk]
  );

  // Morpho shares are 18 decimals in our app
  const withdrawBalanceHuman = useMemo(
    () => formatAmountBigint(BigInt(withdrawPosition?.amount ?? 0n), 18),
    [withdrawPosition]
  );

  // deposit-available wallet balance (pick the richer source chain)
  const depositWalletBalance = useMemo(() => {
    const toNum = (x: bigint | null | undefined, dec = 6) => Number(x ?? 0n) / 10 ** dec;

    if (selectedToken.symbol === 'USDC') {
      const op = toNum(opUsdcBal, 6);
      const ba = toNum(baUsdcBal, 6);
      return op >= ba ? op : ba;
    } else {
      const op = toNum(opUsdtBal, 6);
      const ba = toNum(baUsdtBal, 6);
      return op >= ba ? op : ba;
    }
  }, [selectedToken.symbol, opUsdcBal, baUsdcBal, opUsdtBal, baUsdtBal]);

  // compute available balances for the token selector using OP+Base
  useEffect(() => {
    if (!walletClient) {
      setAvailableTokenBalances({ USDC: 0, USDT: 0 });
      return;
    }
    const user = walletClient.account?.address as `0x${string}`;

    (async () => {
      try {
        const [{ opBal: usdcOp, baBal: usdcBa }, { opBal: usdtOp, baBal: usdtBa }] = await Promise.all([
          getDualBalances(
            {
              optimism: TokenAddresses.USDC.optimism as `0x${string}`,
              base: TokenAddresses.USDC.base as `0x${string}`,
            },
            user
          ),
          getDualBalances(
            {
              optimism: TokenAddresses.USDT.optimism as `0x${string}`,
              base: TokenAddresses.USDT.base as `0x${string}`,
            },
            user
          ),
        ]);

        const toNum = (x: bigint) => Number(x) / 1e6;

        setAvailableTokenBalances({
          USDC: toNum(usdcOp) + toNum(usdcBa),
          USDT: toNum(usdtOp) + toNum(usdtBa),
        });
      } catch {
        setAvailableTokenBalances({ USDC: 0, USDT: 0 });
      }
    })();
  }, [walletClient]);

  // sync the selector with the vault once we have the snapshot
  useEffect(() => {
    if (!snap) return;
    const isUSDT = snap.token === 'USDT';
    setSelectedToken((prev) => ({
      ...prev,
      id: isUSDT ? 'usdt' : 'usdc',
      name: isUSDT ? 'Tether USD' : 'USD Coin',
      symbol: isUSDT ? 'USDT' : 'USDC',
      icon: isUSDT ? '/tokens/usdt-icon.png' : '/tokens/usdc-icon.png',
    }));
  }, [snap]);

  /* -------- Wallet balances (OP/Base/Lisk) -------- */
  useEffect(() => {
    if (!walletClient || !snap) return;
    const user = walletClient.account?.address as `0x${string}`;

    const opSym = symbolForWalletDisplay(snap.token, 'optimism');
    const baSym = symbolForWalletDisplay(snap.token, 'base');
    const liSym = symbolForWalletDisplay(snap.token, 'lisk');

    const addrOrNull = (sym: YieldSnapshot['token'], ch: EvmChain) => {
      try {
        return tokenAddrFor(sym, ch);
      } catch {
        return null;
      }
    };

    const opAddr = addrOrNull(opSym, 'optimism');
    const baAddr = addrOrNull(baSym, 'base');
    const liAddr = addrOrNull(liSym, 'lisk');

    const reads: Promise<bigint | null>[] = [
      opAddr ? readWalletBalance('optimism', opAddr, user) : Promise.resolve(null),
      baAddr ? readWalletBalance('base', baAddr, user) : Promise.resolve(null),
      liAddr ? readWalletBalance('lisk', liAddr, user) : Promise.resolve(null),
    ];

    const liskUSDT0Addr = (TokenAddresses.USDT0 as any)?.lisk as `0x${string}` | undefined;
    if (isUsdtFamily && liskUSDT0Addr) {
      reads.push(readWalletBalance('lisk', liskUSDT0Addr, user));
    } else {
      reads.push(Promise.resolve(null));
    }

    // extra OP/Base USDC+USDT for choosing a source chain
    const opUsdc = addrOrNull('USDC', 'optimism');
    const baUsdc = addrOrNull('USDC', 'base');
    const opUsdt = addrOrNull('USDT', 'optimism');
    const baUsdt = addrOrNull('USDT', 'base');

    reads.push(opUsdc ? readWalletBalance('optimism', opUsdc, user) : Promise.resolve(null));
    reads.push(baUsdc ? readWalletBalance('base', baUsdc, user) : Promise.resolve(null));
    reads.push(opUsdt ? readWalletBalance('optimism', opUsdt, user) : Promise.resolve(null));
    reads.push(baUsdt ? readWalletBalance('base', baUsdt, user) : Promise.resolve(null));

    Promise.allSettled(reads).then((vals) => {
      const v = vals.map((r) => (r.status === 'fulfilled' ? (r as any).value as bigint | null : null));
      const [op, ba, li, liU0, _opUsdc, _baUsdc, _opUsdt, _baUsdt] = v;
      setOpBal(op ?? null);
      setBaBal(ba ?? null);
      setLiBal(li ?? null);
      setLiBalUSDT0(liU0 ?? null);
      setOpUsdcBal(_opUsdc ?? null);
      setBaUsdcBal(_baUsdc ?? null);
      setOpUsdtBal(_opUsdt ?? null);
      setBaUsdtBal(_baUsdt ?? null);
    });
  }, [walletClient, snap, isUsdtFamily]);

  /* -------- Quote (Lisk-only, Deposit side) -------- */
  useEffect(() => {
    if (!walletClient || !amount || !snap) {
      setRoute(null);
      setFee(0n);
      setReceived(0n);
      setQuoteError(null);
      return;
    }
    if (snap.chain !== 'lisk') {
      setRoute(null);
      setFee(0n);
      setReceived(0n);
      setQuoteError('Only Lisk deposits are supported');
      return;
    }

    const amt = parseUnits(amount, tokenDecimals);

    const pickSrcBy = (o?: bigint | null, b?: bigint | null): 'optimism' | 'base' => {
      const op = o ?? 0n,
        ba = b ?? 0n;
      if (op >= amt) return 'optimism';
      if (ba >= amt) return 'base';
      return op >= ba ? 'optimism' : 'base';
    };

    if (destTokenLabel === 'USDT0') {
      const src = selectedToken.symbol === 'USDC' ? pickSrcBy(opUsdcBal, baUsdcBal) : pickSrcBy(opUsdtBal, baUsdtBal);
      getBridgeQuote({
        token: 'USDT0',
        amount: amt,
        from: src,
        to: 'lisk',
        fromAddress: walletClient.account!.address as `0x${string}`,
        fromTokenSym: selectedToken.symbol,
      })
        .then((q) => {
          const minOut = BigInt(q.estimate?.toAmountMin ?? '0');
          const fee = BigInt(q.bridgeFeeTotal ?? '0');
          setRoute(q.route ?? `Bridge ${selectedToken.symbol} → USDT0`);
          setFee(fee);
          setReceived(minOut);
          setQuoteError(null);
        })
        .catch(() => {
          setRoute(null);
          setFee(0n);
          setReceived(0n);
          setQuoteError('Could not fetch bridge quote');
        });
      return;
    }

    if (destTokenLabel === 'USDCe') {
      if ((liBal ?? 0n) >= amt) {
        setRoute('On-chain');
        setFee(0n);
        setReceived(amt);
        setQuoteError(null);
        return;
      }
      quoteUsdceOnLisk({
        amountIn: amt,
        opBal,
        baBal,
        fromAddress: walletClient.account!.address as `0x${string}`,
      })
        .then((q) => {
          setRoute(q.route ?? 'Bridge → USDCe');
          setFee(q.bridgeFee ?? 0n);
          setReceived(q.bridgeOutUSDCe ?? 0n);
          setQuoteError(null);
        })
        .catch(() => {
          setRoute(null);
          setFee(0n);
          setReceived(0n);
          setQuoteError('Could not fetch bridge quote');
        });
      return;
    }

    setRoute('On-chain');
    setFee(0n);
    setReceived(amt);
    setQuoteError(null);
  }, [
    amount,
    walletClient,
    tokenDecimals,
    snap,
    destTokenLabel,
    opBal,
    baBal,
    liBal,
    liBalUSDT0,
    selectedToken.symbol,
    opUsdcBal,
    baUsdcBal,
    opUsdtBal,
    baUsdtBal,
  ]);

  // display numbers
  const amountNum = Number.parseFloat(amount) || 0;
  const bridgeFeeDisplay = useMemo(() => {
    if (!amount || Number(amount) <= 0) return 0;
    if (fee === 0n) return 0.0025; // fallback if quote missing
    return Number(fee) / 10 ** tokenDecimals;
  }, [amount, fee, tokenDecimals]);

  const receiveAmountDisplay = useMemo(() => {
    if (!amount) return 0;
    if (received === 0n) return Math.max(amountNum - 0.0025, 0);
    return Number(received) / 10 ** tokenDecimals;
  }, [amount, amountNum, received, tokenDecimals]);

  // simple placeholders for the withdraw review modal visuals (you can swap to live values later)
  const withdrawBridgeFeeDisplay = 0.0025;
  const withdrawReceiveDisplay = Math.max(amountNum - withdrawBridgeFeeDisplay, 0);
  const withdrawSharesBigint = useMemo(() => {
    try {
      return parseUnits(amount || '0', 18);
    } catch {
      return 0n;
    }
  }, [amount]);

  // token picker list
  const availableTokens: Token[] = [
    {
      id: 'usdc',
      name: 'USD Coin',
      symbol: 'USDC',
      icon: '/tokens/usdc-icon.png',
      balance: availableTokenBalances.USDC,
      address: TokenAddresses.USDC.optimism as `0x${string}`,
    },
    {
      id: 'usdt',
      name: 'Tether USD',
      symbol: 'USDT',
      icon: '/tokens/usdt-icon.png',
      balance: availableTokenBalances.USDT,
      address: TokenAddresses.USDT.optimism as `0x${string}`,
    },
  ];

  const confirmDisabled = !(amountNum > 0) || Boolean(quoteError) || !snap;

  // open review modals instead of executing here
  const onDepositClick = () => {
    if (confirmDisabled || activeTab !== 'deposit') return;
    setShowReview(true);
  };
  const onWithdrawClick = () => {
    if (!(amountNum > 0) || !snap) return;
    setShowWithdrawReview(true);
  };

  if (!snap) {
    return (
      <Card className="w-full max-w-2xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-32 bg-muted rounded" />
          <div className="h-12 bg-muted rounded" />
          <div className="h-10 bg-muted rounded" />
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="w-full max-w-2xl mx-auto p-6">
        {/* Tabs */}
        <div className="flex items-center gap-8 mb-8 border-b">
          <button
            onClick={() => setActiveTab('deposit')}
            className={`pb-3 font-semibold transition-colors relative ${
              activeTab === 'deposit' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Deposit
            {activeTab === 'deposit' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-t" />}
          </button>
          <button
            onClick={() => setActiveTab('withdraw')}
            className={`pb-3 font-semibold transition-colors relative ${
              activeTab === 'withdraw' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Withdraw
            {activeTab === 'withdraw' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-t" />}
          </button>
        </div>

        {/* Content */}
        <div className="space-y-6">
          {/* Label and Balance */}
          <div className="flex items-center justify-between">
            <label className="text-muted-foreground">
              {activeTab === 'deposit' ? 'Deposit' : 'Withdraw'} {selectedToken.symbol}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">
                {activeTab === 'withdraw'
                  ? `${withdrawBalanceHuman} ${destTokenLabel}`
                  : `${depositWalletBalance.toFixed(2)} ${selectedToken.symbol}`}
              </span>
              <button
                onClick={() =>
                  setAmount(
                    activeTab === 'withdraw'
                      ? (Number(withdrawBalanceHuman.replace(/,/g, '')) || 0).toString()
                      : depositWalletBalance.toFixed(2)
                  )
                }
                className="text-primary text-sm font-semibold hover:underline"
              >
                MAX
              </button>
            </div>
          </div>

          {/* Amount Input */}
          <div className="bg-muted rounded-lg p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="text-3xl font-semibold bg-transparent outline-none w-full placeholder:text-muted-foreground"
                />
                <div className="text-muted-foreground mt-2">
                  ${(Number.parseFloat(amount || '0') * 1).toFixed(2)}
                </div>
              </div>

              {/* Token Selector */}
              <button
                onClick={() => setShowTokenModal(true)}
                className="flex items-center gap-2 bg-background px-4 py-2 rounded-lg hover:bg-muted transition-colors border border-border"
              >
                <div className="w-6 h-6 relative">
                  <Image src={selectedToken.icon} alt={selectedToken.symbol} width={24} height={24} className="rounded-full" />
                </div>
                <span className="font-semibold">{selectedToken.symbol}</span>
                <ChevronDown size={20} className="text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Placeholder */}
          {!amount && <div className="text-center py-8 text-muted-foreground rounded-lg bg-muted">Enter an amount</div>}

          {/* CTA */}
          {amount && (
            <>
              <Button
                onClick={activeTab === 'deposit' ? onDepositClick : onWithdrawClick}
                size="lg"
                disabled={confirmDisabled}
                className="w-full text-white bg-blue-600 hover:bg-blue-700 text-lg font-semibold py-6 disabled:opacity-60"
                title={quoteError ?? (activeTab === 'deposit' ? 'Deposit' : 'Withdraw')}
              >
                {activeTab === 'deposit' ? 'Deposit' : 'Withdraw'}
              </Button>

              {/* Route & Fees (keep under BOTH tabs) */}
              <div className="border border-border rounded-lg">
                <button className="w-full px-4 py-4 flex items-center justify-between">
                  <span className="font-semibold text-foreground">Route & fees</span>
                </button>

                {(() => {
                  const isDeposit = activeTab === 'deposit';

                  // Deposit: OP/Base {selectedToken} → Lisk {destTokenLabel}
                  const depSrcChainName = 'OP Mainnet';
                  const depSrcIcon = '/networks/op-icon.png';
                  const depSrcToken = selectedToken.symbol;
                  const depDstChainName = 'Lisk';
                  const depDstIcon = '/networks/lisk.png';
                  const depDstToken = destTokenLabel; // 'USDCe' | 'USDT0' | 'WETH'

                  // Withdraw: Lisk {USDCe|USDT0} → OP/Base {USDC|USDT}
                  const wSrcChainName = 'Lisk';
                  const wSrcIcon = '/networks/lisk.png';
                  const wSrcToken = destTokenLabel; // 'USDCe' | 'USDT0'
                  const wDstChainName = withdrawDest === 'base' ? 'Base' : withdrawDest === 'optimism' ? 'OP Mainnet' : 'Lisk';
                  const wDstIcon =
                    withdrawDest === 'base' ? '/networks/base.png' :
                    withdrawDest === 'optimism' ? '/networks/op-icon.png' :
                    '/networks/lisk.png';
                  const wDstToken =
                    destTokenLabel === 'USDT0' ? 'USDT' :
                    destTokenLabel === 'USDCe' ? 'USDC' :
                    'WETH';

                  // fee/receive token labels
                  const feeToken = isDeposit ? selectedToken.symbol : wDstToken;
                  const receiveToken = isDeposit ? destTokenLabel : wDstToken;

                  return (
                    <div className="border-t border-border px-4 py-4 space-y-4 bg-muted">
                      {/* Route Display */}
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1">
                          <div className="bg-background rounded-lg p-3 flex items-center gap-2 justify-center">
                            <div className="w-4 h-4 relative">
                              <Image
                                src={isDeposit ? depSrcIcon : wSrcIcon}
                                alt={isDeposit ? depSrcChainName : wSrcChainName}
                                width={16}
                                height={16}
                                className="rounded-full"
                              />
                            </div>
                            <span className="text-sm">{isDeposit ? depSrcChainName : wSrcChainName}</span>
                            <span className="text-sm font-semibold">
                              {isDeposit ? depSrcToken : wSrcToken}
                            </span>
                          </div>
                        </div>

                        <span className="text-xl text-muted-foreground">→</span>

                        <div className="flex-1">
                          <div className="bg-background rounded-lg p-3 flex items-center gap-2 justify-center">
                            <div className="w-4 h-4 relative">
                              <Image
                                src={isDeposit ? depDstIcon : wDstIcon}
                                alt={isDeposit ? depDstChainName : wDstChainName}
                                width={16}
                                height={16}
                                className="rounded-full"
                              />
                            </div>
                            <span className="text-sm">{isDeposit ? depDstChainName : wDstChainName}</span>
                            <span className="text-sm font-semibold">
                              {isDeposit ? depDstToken : wDstToken}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Fee Details */}
                      <div className="bg-background rounded-lg p-4 space-y-3">
                        <div className="flex items-start gap-2">
                          <div className="w-6 h-6 relative flex-shrink-0">
                            <Image
                              src="/protocols/bridge-icon.png"
                              alt="Bridge"
                              width={24}
                              height={24}
                              className="rounded-full"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = '/protocols/morpho-icon.png';
                              }}
                            />
                          </div>
                          <div className="flex-1">
                            <p className="text-muted-foreground text-sm">
                              {route ?? 'Routing via LI.FI bridge'}
                            </p>
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-muted-foreground text-sm">Bridge fee (estimated):</span>
                              <span className="font-semibold text-foreground">
                                {bridgeFeeDisplay.toFixed(6)} {feeToken}
                              </span>
                            </div>
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-muted-foreground text-sm">
                                You&apos;ll {isDeposit ? 'deposit' : 'receive'}:
                              </span>
                              <span className="font-semibold text-foreground">
                                {receiveAmountDisplay.toFixed(6)} {receiveToken}
                              </span>
                            </div>
                            {quoteError && (
                              <div className="mt-2 text-xs text-red-600">Quote error: {quoteError}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Token picker */}
      {showTokenModal && (
        <SelectTokenModal
          tokens={availableTokens}
          selectedToken={selectedToken}
          onSelect={(token: any) => {
            setSelectedToken(token);
            setShowTokenModal(false);
          }}
          onClose={() => setShowTokenModal(false)}
        />
      )}

      {/* Deposit review modal */}
      {showReview && activeTab === 'deposit' && snap && (
        <DepositModal
          open={showReview}
          onClose={() => setShowReview(false)}
          snap={snap}
          amount={amount}
          sourceSymbol={selectedToken.symbol}          // "USDC" | "USDT"
          destTokenLabel={destTokenLabel}              // "USDCe" | "USDT0" | "WETH"
          routeLabel={route ?? 'Routing via LI.FI'}    // friendly fallback
          bridgeFeeDisplay={bridgeFeeDisplay}          // number (source token units)
          receiveAmountDisplay={receiveAmountDisplay}  // number (dest token units)
          opBal={opBal}
          baBal={baBal}
          liBal={liBal}
          liBalUSDT0={liBalUSDT0}
          opUsdcBal={opUsdcBal}
          baUsdcBal={baUsdcBal}
          opUsdtBal={opUsdtBal}
          baUsdtBal={baUsdtBal}
        />
      )}

      {/* Withdraw review modal */}
      {showWithdrawReview && activeTab === 'withdraw' && snap && walletClient?.account?.address && (
        <ReviewWithdrawModal
          open={showWithdrawReview}
          onClose={() => setShowWithdrawReview(false)}
          // vault snapshot (expects token 'USDC' | 'USDT', chain 'lisk', and poolAddress)
          snap={{ token: snap.token as 'USDC' | 'USDT', chain: 'lisk', poolAddress: (snap as any).poolAddress }}
          // shares to redeem (18 decimals)
          shares={withdrawSharesBigint}
          // numbers for the review UI
          amountOnLiskDisplay={amountNum}
          bridgeFeeDisplay={withdrawBridgeFeeDisplay}
          receiveOnDestDisplay={withdrawReceiveDisplay}
          // where to send final assets after withdrawing on Lisk
          dest={withdrawDest}
          // user address
          user={walletClient.account!.address as `0x${string}`}
        />
      )}
    </>
  );
}
