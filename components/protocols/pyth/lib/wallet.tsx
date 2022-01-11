import {Keypair} from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import _ from 'lodash';
import {useEffect, useState} from 'react';
import useSWR from 'swr';

interface WalletBalance {
  sol_balance: number;
  usdc_balance: number;
}

interface Order {
  side: 'buy' | 'sell';
  size: number;
  price: number;
  fromToken: string;
  toToken: string;
}

const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export const useExtendedWallet = (useMock = false) => {
  const [secretKey, setSecretKey] = useState<string | undefined>(undefined);

  const [keyPair, setKeyPair] = useState<Keypair | undefined>(undefined);

  const [balance, setBalance] = useState<WalletBalance>({
    sol_balance: 100,
    usdc_balance: 10000,
  });

  const [orderBook, setOrderbook] = useState<Order[]>([]);

  useEffect(() => {
    if (secretKey) {
      let arr = Uint8Array.from(bs58.decode(secretKey));
      const key = Keypair.fromSecretKey(arr);
      setKeyPair(key);
    }
  }, [secretKey]);

  const fetcher = () =>
    axios({
      url: `https://api.mainnet-beta.solana.com`,
      method: 'post',
      headers: {'Content-Type': 'application/json'},
      data: [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [keyPair?.publicKey.toBase58()],
        },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByOwner',
          params: [
            keyPair?.publicKey.toBase58(),
            {
              mint: USDC_MINT_ADDRESS,
            },
            {
              encoding: 'jsonParsed',
            },
          ],
        },
      ],
    });

  const {data, mutate} = useSWR(
    () => `/balance/${keyPair?.publicKey}`,
    fetcher,
    {
      refreshInterval: 5000,
    },
  );
  useEffect(() => {
    if (data && !useMock) {
      const sol_balance = _.get(data, 'data[0].result.value') / 10 ** 9;
      const usdc_balance = _.get(
        data,
        'data[1].result.value[0]account.data.parsed.info.tokenAmount.uiAmount',
      );
      setBalance({sol_balance, usdc_balance});
    }
  }, [data]);

  const [worth, setWorth] = useState({initial: 0, current: 0});

  const addOrder = (order: Order) => {
    setOrderbook((_orderBook) => [order, ..._orderBook]);
  };

  const resetWallet = (params = {sol_balance: 10, usdc_balance: 1400}) => {
    if (!useMock) {
      setSecretKey(undefined);
    } else {
      setBalance({
        sol_balance: params.sol_balance,
        usdc_balance: params.usdc_balance,
      });
    }
  };
  return {
    balance,
    resetWallet,
    keyPair,
    setSecretKey,
    addOrder,
    orderBook,
  };
};
