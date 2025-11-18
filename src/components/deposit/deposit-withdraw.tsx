// src/components/deposit/deposit-withdraw.tsx
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
import logolifi from '@/public/logo_lifi_light.png';
import { useWalletClient } from 'wagmi';
import { parseUnits } from 'viem';
import base_square from '@/public/base_square_blue.svg';

import type { YieldSnapshot } from '@/hooks/useYields';

import { getBridgeQuote, quoteUsdceOnLisk } from '@/lib/quotes';
import { TokenAddresses, getDualBalances } from '@/lib/constants';
import {
  readWalletBalance,
  symbolForWalletDisplay,
  tokenAddrFor,
} from './helpers';

type EvmChain = 'optimism' | 'base' | 'lisk';
type TokenId =
  | 'usdc'
  | 'usdt'
  | 'usdce_lisk'
  | 'usdt0_lisk'
  | 'usdt0_op';

interface Token {
  id: TokenId;
  name: string;
  symbol: 'USDC' | 'USDT' | 'USDCe' | 'USDT0';
  icon: string;
  balance: number;
  address: string;
}

interface DepositWithdrawProps {
  initialTab?: 'deposit' | 'withdraw';
  snap?: YieldSnapshot;
}

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

function toLiskDestLabel(
  src: YieldSnapshot['token'] | 'USDC' | 'USDT' | 'WETH',
): 'USDCe' | 'USDT0' | 'WETH' {
  if (src === 'USDC') return 'USDCe';
  if (src === 'USDT') return 'USDT0';
  return 'WETH';
}

export function DepositWithdraw({
  initialTab = 'deposit',
  snap,
}: DepositWithdrawProps) {
  const { data: walletClient } = useWalletClient();

  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>(initialTab);
  const [amount, setAmount] = useState('');

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

  const [showWithdrawReview, setShowWithdrawReview] = useState(false);
  const [withdrawDest, setWithdrawDest] =
    useState<'lisk' | 'optimism' | 'base'>('optimism');
  const [showWithdrawMenu, setShowWithdrawMenu] = useState(false);

  const [availableTokenBalances, setAvailableTokenBalances] = useState<{
    USDC_Op: number;
    USDT_Op: number;
    USDT0_OP: number;
    USDCe_Lisk: number;
    USDT0_Lisk: number;
  }>({
    USDC_Op: 0,
    USDT_Op: 0,
    USDT0_OP: 0,
    USDCe_Lisk: 0,
    USDT0_Lisk: 0,
  });

  const [opBal, setOpBal] = useState<bigint | null>(null);
  const [baBal, setBaBal] = useState<bigint | null>(null);
  const [liBal, setLiBal] = useState<bigint | null>(null);
  const [liBalUSDT0, setLiBalUSDT0] = useState<bigint | null>(null);
  const [opUsdcBal, setOpUsdcBal] = useState<bigint | null>(null);
  const [baUsdcBal, setBaUsdcBal] = useState<bigint | null>(null);
  const [opUsdtBal, setOpUsdtBal] = useState<bigint | null>(null);
  const [baUsdtBal, setBaUsdtBal] = useState<bigint | null>(null);

  const [route, setRoute] = useState<string | null>(null);
  const [fee, setFee] = useState<bigint>(0n);
  const [received, setReceived] = useState<bigint>(0n);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const vaultToken: 'USDC' | 'USDT' | 'WETH' = (snap?.token as any) ?? 'USDC';
  const tokenDecimals = vaultToken === 'WETH' ? 18 : 6;
  const destTokenLabel = toLiskDestLabel(vaultToken);
  const isUsdtFamily = vaultToken === 'USDT' || destTokenLabel === 'USDT0';

  const { data: positionsRaw } = usePositions();

  const positions = useMemo(
    () =>
      (positionsRaw ?? []) as Array<{
        protocol: string;
        chain: 'lisk' | string;
        token: 'USDCe' | 'USDT0' | 'WETH' | string;
        amount: bigint;
      }>,
    [positionsRaw],
  );
  

  const morphoTokenOnLisk: 'USDCe' | 'USDT0' | 'WETH' = destTokenLabel;
  const withdrawPosition = useMemo(
    () =>
      positions.find(
        (p) =>
          p.protocol === 'Morpho Blue' &&
          p.chain === 'lisk' &&
          (p.token as any) === morphoTokenOnLisk,
      ),
    [positions, morphoTokenOnLisk],
  );

  const withdrawBalanceHuman = useMemo(
    () => formatAmountBigint(BigInt(withdrawPosition?.amount ?? 0n), 18),
    [withdrawPosition],
  );

  const depositWalletBalance = useMemo(() => {
    const toNum6 = (x: bigint | null | undefined) => Number(x ?? 0n) / 1e6;

    switch (selectedToken.id) {
      case 'usdce_lisk':
        return availableTokenBalances.USDCe_Lisk;
      case 'usdt0_lisk':
        return availableTokenBalances.USDT0_Lisk;
      case 'usdt0_op':
        return availableTokenBalances.USDT0_OP;
      case 'usdc': {
        const op = toNum6(opUsdcBal);
        const ba = toNum6(baUsdcBal);
        return op >= ba ? op : ba;
      }
      case 'usdt': {
        const op = toNum6(opUsdtBal);
        const ba = toNum6(baUsdtBal);
        return op >= ba ? op : ba;
      }
      default:
        return 0;
    }
  }, [
    selectedToken.id,
    availableTokenBalances,
    opUsdcBal,
    baUsdcBal,
    opUsdtBal,
    baUsdtBal,
  ]);

  useEffect(() => {
    if (!walletClient) {
      setAvailableTokenBalances({
        USDC_Op: 0,
        USDT_Op: 0,
        USDT0_OP: 0,
        USDCe_Lisk: 0,
        USDT0_Lisk: 0,
      });
      return;
    }
    const user = walletClient.account!.address as `0x${string}`;

    (async () => {
      try {
        const [
          { opBal: usdcOp, baBal: usdcBa },
          { opBal: usdtOp, baBal: usdtBa },
        ] = await Promise.all([
          getDualBalances(
            {
              optimism: TokenAddresses.USDC.optimism as `0x${string}`,
              base: TokenAddresses.USDC.base as `0x${string}`,
            },
            user,
          ),
          getDualBalances(
            {
              optimism: TokenAddresses.USDT.optimism as `0x${string}`,
              base: TokenAddresses.USDT.base as `0x${string}`,
            },
            user,
          ),
        ]);

        const usdceAddr = TokenAddresses.USDCe.lisk as `0x${string}`;
        const usdt0Addr = TokenAddresses.USDT0.lisk as `0x${string}`;
        const usdt0OpAddr = TokenAddresses.USDT0.optimism as `0x${string}`;
        const [usdceLi, usdt0Li, usdt0Op] = await Promise.all([
          readWalletBalance('lisk', usdceAddr, user).catch(() => 0n),
          readWalletBalance('lisk', usdt0Addr, user).catch(() => 0n),
          readWalletBalance('optimism', usdt0OpAddr, user).catch(() => 0n),
        ]);

        const toNum6 = (x: bigint) => Number(x) / 1e6;

        const usdcOpNum = toNum6(usdcOp);
        const usdtOpNum = toNum6(usdtOp);
        const usdt0NumOp = toNum6(usdt0Op);

        setAvailableTokenBalances({
          USDC_Op: usdcOpNum,
          USDT_Op: usdtOpNum,
          USDT0_OP: usdt0NumOp,
          USDCe_Lisk: toNum6(usdceLi),
          USDT0_Lisk: toNum6(usdt0Li),
        });
      } catch {
        setAvailableTokenBalances({
          USDC_Op: 0,
          USDT_Op: 0,
          USDT0_OP: 0,
          USDCe_Lisk: 0,
          USDT0_Lisk: 0,
        });
      }
    })();
  }, [walletClient]);

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
      opAddr
        ? readWalletBalance('optimism', opAddr, user)
        : Promise.resolve(null),
      baAddr ? readWalletBalance('base', baAddr, user) : Promise.resolve(null),
      liAddr ? readWalletBalance('lisk', liAddr, user) : Promise.resolve(null),
    ];

    const liskUSDT0Addr = (TokenAddresses.USDT0 as any)
      ?.lisk as `0x${string}` | undefined;
    if (isUsdtFamily && liskUSDT0Addr) {
      reads.push(readWalletBalance('lisk', liskUSDT0Addr, user));
    } else {
      reads.push(Promise.resolve(null));
    }

    const opUsdc = addrOrNull('USDC', 'optimism');
    const baUsdc = addrOrNull('USDC', 'base');
    const opUsdt = addrOrNull('USDT', 'optimism');
    const baUsdt = addrOrNull('USDT', 'base');

    reads.push(
      opUsdc
        ? readWalletBalance('optimism', opUsdc, user)
        : Promise.resolve(null),
    );
    reads.push(
      baUsdc ? readWalletBalance('base', baUsdc, user) : Promise.resolve(null),
    );
    reads.push(
      opUsdt
        ? readWalletBalance('optimism', opUsdt, user)
        : Promise.resolve(null),
    );
    reads.push(
      baUsdt ? readWalletBalance('base', baUsdt, user) : Promise.resolve(null),
    );

    Promise.allSettled(reads).then((vals) => {
      const v = vals.map((r) =>
        r.status === 'fulfilled' ? ((r as any).value as bigint | null) : null,
      );
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

    const forcedSrc: 'optimism' | 'base' | null = null;

    const pickSrcBy = (
      o?: bigint | null,
      b?: bigint | null,
    ): 'optimism' => {
      const op = o ?? 0n;
      if (op >= amt) return 'optimism';
      return 'optimism';
    };

    if (selectedToken.id === 'usdce_lisk' || selectedToken.id === 'usdt0_lisk') {
      if (selectedToken.id === 'usdce_lisk' && destTokenLabel !== 'USDCe') {
        setRoute(null);
        setFee(0n);
        setReceived(0n);
        setQuoteError('Select USDT0 (Lisk) for this vault.');
        return;
      }
      if (selectedToken.id === 'usdt0_lisk' && destTokenLabel !== 'USDT0') {
        setRoute(null);
        setFee(0n);
        setReceived(0n);
        setQuoteError('Select USDCe (Lisk) for this vault.');
        return;
      }
      setRoute('On-chain');
      setFee(0n);
      setReceived(amt);
      setQuoteError(null);
      return;
    }

    if (destTokenLabel === 'USDT0') {
      const src =
        forcedSrc ??
        (selectedToken.symbol === 'USDC'
          ? pickSrcBy(opUsdcBal, baUsdcBal)
          : pickSrcBy(opUsdtBal, baUsdtBal));

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
          const f = BigInt(q.bridgeFeeTotal ?? '0');
          setRoute(q.route ?? `Bridge ${selectedToken.symbol} → USDT0`);
          setFee(f);
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

      let opBalForQuote = opBal;
      let baBalForQuote = baBal;

      if (forcedSrc === 'base') {
        opBalForQuote = 0n;
      } else if (forcedSrc === 'optimism') {
        baBalForQuote = 0n;
      }

      quoteUsdceOnLisk({
        amountIn: amt,
        opBal: opBalForQuote,
        baBal: baBalForQuote,
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
    selectedToken.id,
    selectedToken.symbol,
    opUsdcBal,
    baUsdcBal,
    opUsdtBal,
    baUsdtBal,
  ]);

  const amountNum = Number.parseFloat(amount) || 0;

  const bridgeFeeDisplay = useMemo(() => {
    if (!amount || Number(amount) <= 0) return 0;
    if (fee === 0n) return 0.0025;
    return Number(fee) / 10 ** tokenDecimals;
  }, [amount, fee, tokenDecimals]);

  const receiveAmountDisplay = useMemo(() => {
    if (!amount) return 0;
    if (received === 0n) return Math.max(amountNum - 0.0025, 0);
    return Number(received) / 10 ** tokenDecimals;
  }, [amount, amountNum, received, tokenDecimals]);

  const withdrawBridgeFeeDisplay = 0.0025;
  const withdrawReceiveDisplay = Math.max(
    amountNum - withdrawBridgeFeeDisplay,
    0,
  );
  const withdrawSharesBigint = useMemo(() => {
    try {
      return parseUnits(amount || '0', 18);
    } catch {
      return 0n;
    }
  }, [amount]);

  const availableTokens: Token[] = [
    {
      id: 'usdc',
      name: 'USD Coin (OP Mainnet)',
      symbol: 'USDC',
      icon: '/tokens/usdc-icon.png',
      balance: availableTokenBalances.USDC_Op,
      address: TokenAddresses.USDC.optimism as `0x${string}`,
    },
    {
      id: 'usdt',
      name: 'Tether USD (OP Mainnet)',
      symbol: 'USDT',
      icon: '/tokens/usdt-icon.png',
      balance: availableTokenBalances.USDT_Op,
      address: TokenAddresses.USDT.optimism as `0x${string}`,
    },
    {
      id: 'usdt0_op',
      name: 'USDT0 (OP Mainnet)',
      symbol: 'USDT0',
      icon: '/tokens/usdt0-icon.png',
      balance: availableTokenBalances.USDT0_OP,
      address: TokenAddresses.USDT0.optimism as `0x${string}`,
    },
    {
      id: 'usdce_lisk',
      name: 'USDC.e (Lisk)',
      symbol: 'USDCe',
      icon: '/tokens/usdc-icon.png',
      balance: availableTokenBalances.USDCe_Lisk,
      address: TokenAddresses.USDCe.lisk as `0x${string}`,
    },
    {
      id: 'usdt0_lisk',
      name: 'USDT0 (Lisk)',
      symbol: 'USDT0',
      icon: '/tokens/usdt0-icon.png',
      balance: availableTokenBalances.USDT0_Lisk,
      address: TokenAddresses.USDT0.lisk as `0x${string}`,
    },
  ];

  const withdrawChoices = useMemo(
    () => {
      const isUSDT = destTokenLabel === 'USDT0';
      const stableSymbol = isUSDT ? 'USDT' : 'USDC';
      return [
        {
          id: 'optimism' as const,
          chainLabel: 'OP Mainnet',
          symbol: stableSymbol,
          icon: '/networks/op-icon.png',
          description: `Bridge to OP ${stableSymbol}`,
        },
      ];
    },
    [destTokenLabel],
  );

  const currentWithdrawChoice =
    withdrawChoices.find((c) => c.id === withdrawDest) ?? withdrawChoices[0];

    const sourceSymbolForModal: 'USDC' | 'USDT' | 'USDCe' | 'USDT0' =
    selectedToken.id === 'usdce_lisk'
      ? 'USDCe'
      : selectedToken.id === 'usdt0_lisk' || selectedToken.id === 'usdt0_op'
      ? 'USDT0'
      : selectedToken.id === 'usdt'
      ? 'USDT'
      : 'USDC';


  const confirmDisabled =
    !(amountNum > 0) ||
    Boolean(quoteError) ||
    !snap ||
    (selectedToken.id === 'usdce_lisk' && destTokenLabel !== 'USDCe') ||
    (selectedToken.id === 'usdt0_lisk' && destTokenLabel !== 'USDT0');

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
      <Card className="w-full max-w-2xl mx-auto p-6 shadow-none">
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
      <Card className="w-full max-w-2xl mx-auto p-6 shadow-none">
        <div className="flex items-center gap-8 mb-8 border-b">
          <button
            onClick={() => setActiveTab('deposit')}
            className={`pb-3 font-semibold transition-colors relative ${
              activeTab === 'deposit'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Deposit
            {activeTab === 'deposit' && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-t" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('withdraw')}
            className={`pb-3 font-semibold transition-colors relative ${
              activeTab === 'withdraw'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Withdraw
            {activeTab === 'withdraw' && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-t" />
            )}
          </button>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <label className="text-muted-foreground">
              {activeTab === 'deposit' ? 'Deposit' : 'Withdraw'}{' '}
              {activeTab === 'deposit'
                ? selectedToken.symbol
                : destTokenLabel}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">
                {activeTab === 'withdraw'
                  ? `${withdrawBalanceHuman} ${destTokenLabel}`
                  : `${depositWalletBalance.toFixed(
                      2,
                    )} ${selectedToken.symbol}`}
              </span>
              <button
                onClick={() => {
                  if (activeTab === 'withdraw') {
                    const raw =
                      Number(withdrawBalanceHuman.replace(/,/g, '')) || 0;
                    if (raw <= 0) {
                      setAmount('');
                      return;
                    }
                    const factor = 1e6;
                    const floored = Math.floor(raw * factor) / factor;
                    setAmount(floored.toString());
                  } else {
                    const raw = depositWalletBalance;
                    if (!Number.isFinite(raw) || raw <= 0) {
                      setAmount('');
                      return;
                    }
                    const factor = 1e6;
                    const floored = Math.floor(raw * factor) / factor;
                    setAmount(floored.toString());
                  }
                }}
                className="text-primary text-sm font-semibold hover:underline"
              >
                MAX
              </button>
            </div>
          </div>

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

              {activeTab === 'deposit' ? (
                <button
                  onClick={() => setShowTokenModal(true)}
                  className="flex items-center gap-2 bg-background px-4 py-2 rounded-lg hover:bg-muted transition-colors border border-border"
                >
                  <div className="w-6 h-6 relative">
                    <Image
                      src={selectedToken.icon}
                      alt={selectedToken.symbol}
                      width={24}
                      height={24}
                      className="rounded-full"
                    />
                  </div>
                  <span className="font-semibold">{selectedToken.symbol}</span>
                  <ChevronDown
                    size={20}
                    className="text-muted-foreground"
                  />
                </button>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowWithdrawMenu((v) => !v)}
                    className="flex items-center gap-2 bg-background px-4 py-2 rounded-lg hover:bg-muted transition-colors border border-border"
                  >
                    <div className="w-6 h-6 relative">
                      <Image
                        src={currentWithdrawChoice.icon}
                        alt={currentWithdrawChoice.chainLabel}
                        width={24}
                        height={24}
                        className="rounded-full"
                      />
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="font-semibold">
                        {currentWithdrawChoice.symbol}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {currentWithdrawChoice.chainLabel}
                      </span>
                    </div>
                    <ChevronDown
                      size={20}
                      className="text-muted-foreground ml-1"
                    />
                  </button>

                  {showWithdrawMenu && (
                    <div className="absolute right-0 mt-2 w-56 rounded-lg border bg-popover shadow-lg z-20">
                      {withdrawChoices.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          onClick={() => {
                            setWithdrawDest(choice.id);
                            setShowWithdrawMenu(false);
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${
                            choice.id === withdrawDest
                              ? 'bg-muted'
                              : 'bg-popover'
                          }`}
                        >
                          <div className="w-5 h-5 relative">
                            <Image
                              src={choice.icon}
                              alt={choice.chainLabel}
                              width={20}
                              height={20}
                              className="rounded-full"
                            />
                          </div>
                          <div className="flex flex-col">
                            <span className="font-semibold">
                              {choice.symbol} • {choice.chainLabel}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {choice.description}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {!amount && (
            <div className="text-center py-8 text-muted-foreground rounded-lg bg-muted">
              Enter an amount
            </div>
          )}

          {amount && (
            <>
              <Button
                onClick={activeTab === 'deposit' ? onDepositClick : onWithdrawClick}
                size="lg"
                disabled={confirmDisabled}
                className="w-full text-white bg-blue-600 hover:bg-blue-700 text-lg font-semibold py-6 disabled:opacity-60"
                title={
                  quoteError ??
                  (activeTab === 'deposit' ? 'Deposit' : 'Withdraw')
                }
              >
                {activeTab === 'deposit' ? 'Deposit' : 'Withdraw'}
              </Button>

              <div className="border border-border rounded-lg">
                <button className="w-full px-4 py-4 flex items-center justify-between">
                  <span className="font-semibold text-foreground">Route & fees</span>
                </button>

                {(() => {
                  const isDeposit = activeTab === 'deposit';

                  const depSrcChainName =
                    selectedToken.id === 'usdce_lisk' || selectedToken.id === 'usdt0_lisk'
                      ? 'Lisk'
                      : 'OP Mainnet';
                  const depSrcIcon =
                    selectedToken.id === 'usdce_lisk' || selectedToken.id === 'usdt0_lisk'
                      ? '/networks/lisk.png'
                      : '/networks/op-icon.png';
                  const depSrcToken = selectedToken.symbol;
                  const depDstChainName = 'Lisk';
                  const depDstIcon = '/networks/lisk.png';
                  const depDstToken = destTokenLabel;

                  const wSrcChainName = 'Lisk';
                  const wSrcIcon = '/networks/lisk.png';
                  const wSrcToken = destTokenLabel;
                  const wDstChainName =
                    withdrawDest === 'base'
                      ? 'Base'
                      : withdrawDest === 'optimism'
                        ? 'OP Mainnet'
                        : 'Lisk';
                  const wDstIcon =
                    withdrawDest === 'base'
                      ? '/networks/base.png'
                      : withdrawDest === 'optimism'
                        ? '/networks/op-icon.png'
                        : '/networks/lisk.png';
                  const wDstToken =
                    withdrawDest === 'lisk'
                      ? destTokenLabel
                      : destTokenLabel === 'USDT0'
                        ? 'USDT'
                        : destTokenLabel === 'USDCe'
                          ? 'USDC'
                          : 'WETH';

                  const feeToken = isDeposit ? selectedToken.symbol : wDstToken;
                  const receiveToken = isDeposit ? destTokenLabel : wDstToken;

                  const bridgingOnDeposit =
                    isDeposit &&
                    !(selectedToken.id === 'usdce_lisk' || selectedToken.id === 'usdt0_lisk') &&
                    (destTokenLabel === 'USDT0' || destTokenLabel === 'USDCe');

                  const bridgingOnWithdraw = !isDeposit && withdrawDest !== 'lisk';

                  const protocolFee =
                    !isDeposit && amountNum > 0 ? amountNum * 0.005 : 0;

                  const bridgeFee =
                    isDeposit
                      ? (bridgingOnDeposit ? bridgeFeeDisplay : 0)
                      : (bridgingOnWithdraw ? withdrawBridgeFeeDisplay : 0);

                  const totalFee = protocolFee + bridgeFee;

                  const receiveDisplay = (() => {
                    if (isDeposit) return receiveAmountDisplay;
                    const gross = amountNum;
                    const net = Math.max(
                      gross - protocolFee - (bridgingOnWithdraw ? withdrawBridgeFeeDisplay : 0),
                      0,
                    );
                    return net;
                  })();

                  const routeLabel = (() => {
                    if (isDeposit) {
                      if (route && route !== 'On-chain') return route;
                      if (bridgingOnDeposit) {
                        return `${depSrcChainName.toUpperCase()} → ${depDstChainName.toUpperCase()}`;
                      }
                      return 'On-chain';
                    }
                    if (!bridgingOnWithdraw) return 'On-chain';
                    return `${wSrcChainName.toUpperCase()} → ${wDstChainName.toUpperCase()}`;
                  })();

                  return (
                    <div className="border-t border-border px-4 py-4 space-y-4 bg-muted">
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
                            <span className="text-sm">
                              {isDeposit ? depSrcChainName : wSrcChainName}
                            </span>
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
                            <span className="text-sm">
                              {isDeposit ? depDstChainName : wDstChainName}
                            </span>
                            <span className="text-sm font-semibold">
                              {isDeposit ? depDstToken : wDstToken}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-background rounded-lg p-4 space-y-3">
                        <div className="flex items-start gap-2">
                          <div className="w-6 h-6 relative flex-shrink-0">
                            <Image
                              src={logolifi}
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
                              {routeLabel}
                            </p>

                            <div className="flex items-center justify-between mt-2">
                              <span className="text-muted-foreground text-sm">
                                Total fee (estimated):
                              </span>
                              <span className="font-semibold text-foreground">
                                {totalFee.toFixed(6)} {feeToken}
                              </span>
                            </div>

                            {!isDeposit && amountNum > 0 && (
                              <div className="mt-1 text-[11px] text-muted-foreground space-y-0.5">
                                <div>• 0.5% vault withdraw fee</div>
                                {bridgingOnWithdraw && (
                                  <div>• Bridge fee via LI.FI (est.)</div>
                                )}
                              </div>
                            )}

                            <div className="flex items-center justify-between mt-2">
                              <span className="text-muted-foreground text-sm">
                                You&apos;ll {isDeposit ? 'deposit' : 'receive'}:
                              </span>
                              <span className="font-semibold text-foreground">
                                {receiveDisplay.toFixed(6)} {receiveToken}
                              </span>
                            </div>

                            {quoteError && isDeposit && (
                              <div className="mt-2 text-xs text-red-600">
                                Quote error: {quoteError}
                              </div>
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

      {showReview && activeTab === 'deposit' && snap && (
       <DepositModal
       open={showReview}
       onClose={() => setShowReview(false)}
       snap={snap}
       amount={amount}
       sourceSymbol={sourceSymbolForModal}
       destTokenLabel={destTokenLabel}
       routeLabel={
         route ??
         (selectedToken.id.includes('_lisk')
           ? 'On-chain'
           : 'Routing via LI.FI')
       }
       bridgeFeeDisplay={
         selectedToken.id.includes('_lisk') ? 0 : bridgeFeeDisplay
       }
       receiveAmountDisplay={receiveAmountDisplay}
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

      {showWithdrawReview &&
        activeTab === 'withdraw' &&
        snap &&
        walletClient?.account?.address && (
          <ReviewWithdrawModal
            open={showWithdrawReview}
            onClose={() => setShowWithdrawReview(false)}
            snap={{
              token: snap.token as 'USDC' | 'USDT',
              chain: 'lisk',
              poolAddress: (snap as any).poolAddress,
            }}
            shares={withdrawSharesBigint}
            amountOnLiskDisplay={amountNum}
            bridgeFeeDisplay={
              withdrawDest === 'lisk' ? 0 : withdrawBridgeFeeDisplay
            }
            receiveOnDestDisplay={
              withdrawDest === 'lisk' ? amountNum : withdrawReceiveDisplay
            }
            dest={withdrawDest}
            user={walletClient.account!.address as `0x${string}`}
          />
        )}
    </>
  );
}
