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
import {clusterApiUrl, Connection, Keypair, PublicKey} from '@solana/web3.js';
import {PythConnection, getPythProgramKeyForCluster} from '@pythnetwork/client';
import {DollarCircleFilled} from '@ant-design/icons';
import {Chart} from './Chart';
import {EventEmitter} from 'events';
import {PYTH_NETWORKS, SOLANA_NETWORKS} from 'types/index';
import {JupiterProvider} from '@jup-ag/react-hook';
import {useExtendedWallet} from '@figment-pyth/lib/wallet';
import {SwapClient} from '@figment-pyth/lib/swap';
import {useConnection, useWallet} from '@solana/wallet-adapter-react';
import _ from 'lodash';
import Form from 'antd/lib/form/Form';

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
  price: number;
  fromToken: string;
  toToken: string;
}

const signalListener = new EventEmitter();

const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
const SERUM_MINT_ADDRESS = 'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt';
const USDT_MINT_ADDRESS = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const useSwap = (keyPair: Keypair | undefined) => {
  const [swapClient, setSwapClient] = useState<SwapClient | null>(null);

  useEffect(() => {
    async function _init(key: Keypair): Promise<void> {
      const _swapClient = await SwapClient.initialize(
        connection,
        // new Connection(clusterApiUrl('devnet'), 'confirmed'),
        SOLANA_NETWORKS.MAINNET,
        key,
        SOL_MINT_ADDRESS,
        USDC_MINT_ADDRESS,
      );
      setSwapClient(_swapClient);
    }
    if (keyPair) {
      _init(keyPair);
    }
  }, [keyPair]);
};

const Exchange = () => {
  const {state, dispatch} = useGlobalState();
  const {connection} = useConnection();

  const [useMock, setUseMock] = useState(false);
  const {setSecretKey, keyPair, balance, addOrder, orderBook, resetWallet} =
    useExtendedWallet(useMock);

  // amount of Ema to buy/sell signal.
  const [yieldExpectation, setYield] = useState<number>(0.001);
  const [orderSize, setOrderSize] = useState<number>(20); // USDC
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [symbol, setSymbol] = useState<string | undefined>(undefined);

  const [swapClient, setSwapClient] = useState<SwapClient | null>(null);
  useEffect(() => {
    async function _init(key: Keypair): Promise<void> {
      const _swapClient = await SwapClient.initialize(
        connection,
        // new Connection(clusterApiUrl('devnet'), 'confirmed'),
        SOLANA_NETWORKS.MAINNET,
        key,
        SOL_MINT_ADDRESS,
        USDC_MINT_ADDRESS,
      );
      setSwapClient(_swapClient);
    }
    if (keyPair) {
      _init(keyPair);
    }
  }, [keyPair]);

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
    const buyHandler = signalListener.on('buy', async (price: number) => {
      // if (wallet.usdc_balance <= orderSize) return; // not enough balance
      // await swapClient?.buy(orderSize);
      addOrder({
        side: 'buy',
        size: orderSize,
        price: price,
        fromToken: 'usdc',
        toToken: 'sol',
      });
      // setOrderbook((_orderBook) => [
      //   {
      //     side: 'buy',
      //     size: orderSize,
      //     price: price,
      //     fromToken: 'usdc',
      //     toToken: 'sol',
      //   },
      //   ..._orderBook,
      // ]);
      // const solChange = orderSize / price!;

      // setWallet((_wallet) => ({
      //   sol_balance: _wallet.sol_balance + solChange,
      //   usdc_balance: _wallet.usdc_balance - orderSize,
      // }));
    });

    const sellHandler = signalListener.on('sell', async (price: number) => {
      const orderSizeSol = orderSize / price;
      // if (wallet.sol_balance <= orderSizeSol) return; // not enough balance
      // await swapClient?.sell(orderSizeSol);
      addOrder({
        side: 'sell',
        size: orderSizeSol,
        price: price,
        fromToken: 'sol',
        toToken: 'usdc',
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
                  unCheckedChildren={'Mainnet'}
                />
                <Button onClick={() => resetWallet()} disabled={!useMock}>
                  Reset Wallet
                </Button>
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
          <Button onClick={async () => await swapClient?.buy(0.1)}>Buy</Button>
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
