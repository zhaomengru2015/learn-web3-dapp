import {
  Col,
  Space,
  Switch,
  message,
  Statistic,
  Card,
  Button,
  InputNumber,
  Table,
  Row,
  Input,
} from 'antd';
import {useGlobalState} from 'context';
import {SyncOutlined} from '@ant-design/icons';
import {useEffect, useState} from 'react';
import {
  Cluster,
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
} from '@solana/web3.js';
import {PythConnection, getPythProgramKeyForCluster} from '@pythnetwork/client';
import {DollarCircleFilled} from '@ant-design/icons';
import {Chart} from './Chart';
import {EventEmitter} from 'events';
import {PYTH_NETWORKS, SOLANA_NETWORKS} from 'types/index';
import {useExtendedWallet} from '@figment-pyth/lib/wallet';
import {JupiterSwapClient} from '@figment-pyth/lib/swap';
import _ from 'lodash';
import * as Rx from 'rxjs';

import {getOrca, Network, OrcaPoolConfig} from '@orca-so/sdk';
import Decimal from 'decimal.js';

const connection = new Connection(clusterApiUrl(PYTH_NETWORKS.DEVNET));
const pythPublicKey = getPythProgramKeyForCluster(PYTH_NETWORKS.DEVNET);
const pythConnection = new PythConnection(connection, pythPublicKey);

enum tokens {
  SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112',
  SERUM_MINT_ADDRESS = 'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt',
  USDT_MINT_ADDRESS = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
}

interface Order {
  side: 'buy' | 'sell';
  size: number;
  fromToken: string;
  toToken: string;
}

const signalListener = new EventEmitter();

const Exchange = () => {
  const {state, dispatch} = useGlobalState();
  const [cluster, setCluster] = useState<Cluster>('devnet');

  const [useMock, setUseMock] = useState(true);
  const {setSecretKey, keyPair, balance, addOrder, orderBook, resetWallet} =
    useExtendedWallet(useMock, cluster);

  // amount of Ema to buy/sell signal.
  const [yieldExpectation, setYield] = useState<number>(0.001);
  const [orderSize, setOrderSize] = useState<number>(20); // USDC
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [symbol, setSymbol] = useState<string | undefined>(undefined);

  // const [swapClient, setSwapClient] = useState<JupiterSwapClient | null>(null);
  // useEffect(() => {
  //   async function _init(key: Keypair): Promise<void> {
  //     const _swapClient = await JupiterSwapClient.initialize(
  //       // connection,
  //       new Connection(clusterApiUrl('devnet'), 'confirmed'),
  //       SOLANA_NETWORKS.DEVNET,
  //       key,
  //       SOL_MINT_ADDRESS,
  //       USDC_MINT_ADDRESS,
  //     );
  //     setSwapClient(_swapClient);
  //   }
  //   if (keyPair) {
  //     // _init(keyPair);
  //   }
  // }, [keyPair]);

  // state for tracking user worth with current Market Price.
  const [worth, setWorth] = useState({initial: 0, current: 0});

  // Reset the wallet to the initial state.

  useEffect(() => {
    if (price) {
      dispatch({
        type: 'SetIsCompleted',
      });
    }
    // update the current worth each price update.
    const currentWorth = balance?.sol_balance * price! + balance.usdc_balance;
    setWorth({...worth, current: currentWorth});
  }, [price, setPrice]);

  useEffect(() => {
    signalListener.once('*', () => {
      // resetWallet();
    });
    const buy = Rx.fromEvent(signalListener, 'buy').pipe(
      Rx.map((v: any) => orderSize),
    );
    const sell = Rx.fromEvent(signalListener, 'sell').pipe(
      Rx.map((v: any) => -orderSize),
    );
    Rx.merge(buy, sell)
      .pipe(
        Rx.bufferTime(3000),
        Rx.map((orders: number[]) => {
          return orders.reduce((prev, curr) => prev + curr, 0); // sum of the orders in the buffer.
        }),
        Rx.filter((v) => v !== 0),
        Rx.map((val: number) => {
          if (val > 0) {
            // buy.
            return {
              side: 'buy',
              size: val,
              fromToken: 'usdc',
              toToken: 'sol',
            };
          } else if (val <= 0) {
            return {
              side: 'sell',
              size: Math.abs(val),
              fromToken: 'sol',
              toToken: 'usdc',
            };
          }
        }),
      )
      .subscribe((v: any) => {
        addOrder({
          ...v,
          price: price!,
        });
      });
    return () => {
      signalListener.removeAllListeners();
    };
  }, [yieldExpectation, orderSize]);

  const [data, setData] = useState<any[]>([]);
  const getPythData = async (checked: boolean) => {
    pythConnection.onPriceChange((product, price) => {
      // sample output: SRM/USD: $8.68725 ±$0.0131
      if (
        product.symbol === 'Crypto.SOL/USD' &&
        price.price &&
        price.confidence
      ) {
        console.log(
          `${product.symbol}: $${price.price} \xB1$${price.confidence}`,
        );
        setPrice(price.price);

        const newData: {
          price: number;
          priceConfidenceRange: number[];
          ts: number;
          sma: undefined | number;
          ema: undefined | number;
          trend: undefined | boolean;
        } = {
          price: price.price,
          priceConfidenceRange: [
            price?.price! - price?.confidence!,
            price?.price! + price?.confidence!,
          ],
          ts: +new Date(),
          sma: undefined,
          ema: undefined,
          trend: undefined,
        };
        const window = 10;
        const smoothingFactor = 2 / (window + 1);
        /**
         * Calculate Simple moving average:
         *   https://en.wikipedia.org/wiki/Moving_average#Simple_moving_average
         * Calculate Exponential moving average:
         *   https://en.wikipedia.org/wiki/Moving_average#Exponential_moving_average
         * The Exponential moving average has a better reaction to price changes.
         *
         * Ref: https://blog.oliverjumpertz.dev/the-moving-average-simple-and-exponential-theory-math-and-implementation-in-javascript
         */
        setData((data) => {
          if (data.length > window) {
            const windowSlice = data.slice(data.length - window, data.length);
            const sum = windowSlice.reduce(
              (prev, curr) => prev + curr.price,
              0,
            );
            newData.sma = sum / window;

            const previousEma = newData.ema || newData.sma;
            const currentEma =
              (newData.price - previousEma) * smoothingFactor + previousEma;
            newData.ema = currentEma;

            const trend = newData.ema / data[data.length - 1].ema;
            if (trend * 100 > 100 + yieldExpectation) {
              signalListener.emit('buy', newData.price);
            } else if (trend * 100 < 100 - yieldExpectation) {
              signalListener.emit('sell', newData.price);
            }
          }
          return [...data, newData];
        });
        setSymbol('Crypto.SOL/USD');
      } else if (product.symbol === 'Crypto.SOL/USD' && !price.price) {
        console.log(`${product.symbol}: price currently unavailable`);
        setPrice(0);
        setSymbol('Crypto.SOL/USD');
      }
    });

    if (!checked) {
      message.info('Stopping Pyth price feed!');
      pythConnection.stop();
    } else {
      message.info('Starting Pyth price feed!');
      pythConnection.start();
    }
  };

  const buySomeOrca = async () => {
    const orca = getOrca(connection, Network.DEVNET);
    const orcaSolPool = orca.getPool(OrcaPoolConfig.ORCA_SOL);
    const solToken = orcaSolPool.getTokenB();
    const solAmount = new Decimal(0.1);
    const quote = await orcaSolPool.getQuote(solToken, solAmount);
    const orcaAmount = quote.getMinOutputAmount();
    console.log(
      `Swap ${solAmount.toString()} SOL for at least ${orcaAmount.toNumber()} ORCA`,
    );
    const swapPayload = await orcaSolPool.swap(
      keyPair!,
      solToken,
      solAmount,
      orcaAmount,
    );
    const swapTxId = await swapPayload.execute();
    console.log('Swapped:', swapTxId, '\n');

    const orcaUSDCPool = orca.getPool(OrcaPoolConfig.ORCA_USDC);
    const orcaToken = orcaUSDCPool.getTokenA();
    const usdcQuote = await orcaUSDCPool.getQuote(orcaToken, orcaAmount);
    const usdcAmount = usdcQuote.getMinOutputAmount();
    const swapOrcaPayload = await orcaUSDCPool.swap(
      keyPair!,
      orcaToken,
      orcaAmount,
      usdcAmount,
    );
    console.log(
      `Swap ${orcaAmount.toString()} ORCA for at least ${usdcAmount.toNumber()} USDC`,
    );

    const swapOrcaTxId = await swapOrcaPayload.execute();
    console.log('Swapped:', swapOrcaTxId, '\n');
    return [swapTxId, swapOrcaTxId];
  };
  return (
    <Col>
      <Space direction="vertical" size="large">
        <Space direction="horizontal">
          <Card
            size="small"
            title={symbol}
            style={{width: 400}}
            extra={
              <Switch
                checkedChildren={<SyncOutlined spin />}
                unCheckedChildren={'Price feed Off'}
                onChange={getPythData}
              />
            }
          >
            <Statistic value={price} prefix={<DollarCircleFilled />} />{' '}
          </Card>
          <Card title={'Yield Expectation'} size={'small'}>
            <InputNumber
              value={yieldExpectation}
              onChange={(e) => setYield(e)}
              prefix="%"
            />
            <InputNumber
              value={orderSize}
              onChange={(e) => setOrderSize(e)}
              prefix="USDC"
            />
          </Card>
        </Space>
        <Space direction="horizontal" size="large">
          <Card
            title="wallet"
            extra={
              <>
                <Switch
                  checked={useMock}
                  onChange={(val) => setUseMock(val)}
                  checkedChildren={'Mock'}
                  unCheckedChildren={'Real'}
                />
                {!useMock ? (
                  <Switch
                    checked={cluster === 'mainnet-beta'}
                    onChange={(val) =>
                      setCluster(val ? 'mainnet-beta' : 'devnet')
                    }
                    checkedChildren={'Mainnet'}
                    unCheckedChildren={'Devnet'}
                  />
                ) : (
                  <Button onClick={() => resetWallet()} disabled={!useMock}>
                    Reset Wallet
                  </Button>
                )}
              </>
            }
          >
            {!useMock ? (
              <Row>
                <label htmlFor="secretKey">Wallet Secretkey</label>
                <Input
                  id="secretKey"
                  type="password"
                  onChange={(e) => setSecretKey(e.target.value)}
                />
              </Row>
            ) : null}
            <Row>
              <Col span={12}>
                <Statistic
                  value={balance?.sol_balance}
                  precision={6}
                  title={'SOL'}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  value={balance?.usdc_balance}
                  precision={6}
                  title={'USDC'}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  value={balance?.orca_balance}
                  precision={6}
                  title={'ORCA'}
                />
              </Col>

              <Col span={12}>
                <Statistic
                  value={balance?.sol_balance * price! + balance.usdc_balance}
                  precision={6}
                  title={'TOTAL WORTH'}
                />
              </Col>

              <Col span={12}>
                <Statistic
                  value={(worth.initial / worth.current) * 100 - 100}
                  prefix={'%'}
                  precision={6}
                  title={'Change'}
                />
              </Col>
            </Row>
          </Card>
        </Space>
        <Card>
          {/* <Button onClick={async () => await buy()}>Buy</Button> */}
          {/* <Button onClick={async () => await swapClient?.buy(0.1)}>Buy</Button> */}
          <Button onClick={async () => await buySomeOrca()}>Buy</Button>
        </Card>
        <Card>
          <Chart data={data} />
        </Card>
        <Card>
          <Statistic value={orderBook.length} title={'Number of Operations'} />
          <Table
            dataSource={orderBook}
            columns={[
              {
                title: 'Side',
                dataIndex: 'side',
                key: 'side',
              },
              {
                title: 'Price',
                dataIndex: 'price',
                key: 'price',
              },
              {
                title: 'Size',
                dataIndex: 'size',
                key: 'size',
              },
              {
                title: 'From',
                dataIndex: 'fromToken',
                key: 'fromToken',
              },
              {
                title: 'To',
                dataIndex: 'toToken',
                key: 'toToken',
              },
            ]}
          ></Table>
        </Card>
      </Space>
    </Col>
  );
};

export default Exchange;
