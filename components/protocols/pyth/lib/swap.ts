import {Cluster, Connection, Keypair, PublicKey} from '@solana/web3.js';
import {Jupiter, RouteInfo, TOKEN_LIST_URL} from '@jup-ag/core';

const _account = Keypair.fromSecretKey(
  new Uint8Array([
    175, 193, 241, 226, 223, 32, 155, 13, 1, 120, 157, 36, 15, 39, 141, 146,
    197, 180, 138, 112, 167, 209, 70, 94, 103, 202, 166, 62, 81, 18, 143, 49,
    125, 253, 127, 53, 71, 38, 254, 214, 30, 170, 71, 69, 80, 46, 52, 76, 101,
    246, 34, 16, 96, 4, 164, 39, 220, 88, 184, 201, 138, 180, 181, 238,
  ]),
);

// Interface
export interface Token {
  chainId: number; // 101,
  address: string; // '8f9s1sUmzUbVZMoMh6bufMueYH1u4BJSM57RCEvuVmFp',
  symbol: string; // 'TRUE',
  name: string; // 'TrueSight',
  decimals: number; // 9,
  logoURI: string; // 'https://i.ibb.co/pKTWrwP/true.jpg',
  tags: string[]; // [ 'utility-token', 'capital-token' ]
}

export class SwapClient {
  private jupiter: Jupiter;

  constructor(
    jupiter: Jupiter,
    readonly tokenA: Token,
    readonly tokenB: Token,
  ) {
    this.jupiter = jupiter;
  }

  static async initialize(
    connection: Connection,
    cluster: Cluster,
    user: Keypair,
    tokenAMintAddress: String, // Token to buy
    tokenBMintAddress: String, // token to sell
  ) {
    const jupiter = await Jupiter.load({connection, cluster, user});
    const tokens: Token[] = await (await fetch(TOKEN_LIST_URL[cluster])).json(); // Fetch token list from Jupiter API

    const inputToken = tokens.find((t) => t.address == tokenAMintAddress); // Buy token
    const outputToken = tokens.find((t) => t.address == tokenBMintAddress); // Sell token
    if (!inputToken || !outputToken) {
      throw new Error('Token not found');
    }

    return new SwapClient(jupiter, inputToken, outputToken);
  }

  async getRoutes({
    inputToken,
    outputToken,
    inputAmount,
    slippage,
  }: {
    inputToken?: Token;
    outputToken?: Token;
    inputAmount: number;
    slippage: number;
  }) {
    if (!inputToken || !outputToken) {
      return null;
    }

    console.log('Getting routes');
    const inputAmountLamports = inputToken
      ? Math.round(inputAmount * 10 ** inputToken.decimals)
      : 0; // Lamports based on token decimals
    const routes =
      inputToken && outputToken
        ? await this.jupiter.computeRoutes(
            new PublicKey(inputToken.address),
            new PublicKey(outputToken.address),
            inputAmountLamports,
            slippage,
            true,
          )
        : null;

    if (routes && routes.routesInfos) {
      console.log('Possible number of routes:', routes.routesInfos.length);
      console.log('Best quote: ', routes.routesInfos[0].outAmount);
      return routes;
    } else {
      return null;
    }
  }

  async buy(size: number) {
    const routes = await this.getRoutes({
      inputToken: this.tokenA,
      outputToken: this.tokenB,
      inputAmount: size, // 1 unit in UI
      slippage: 1, // 1% slippage
    });
    if (routes?.routesInfos) {
      this.executeSwap(routes?.routesInfos[0]);
    } else {
      throw new Error('Route not found');
    }
  }

  async sell(size: number) {
    const routes = await this.getRoutes({
      inputToken: this.tokenB,
      outputToken: this.tokenA,
      inputAmount: size, // 1 unit in UI
      slippage: 1, // 1% slippage
    });
    if (routes?.routesInfos) {
      this.executeSwap(routes?.routesInfos[0]);
    } else {
      throw new Error('Route not found');
    }
  }

  async executeSwap(route: RouteInfo) {
    // Prepare execute exchange
    const {execute} = await this.jupiter.exchange({
      route,
    });
    // Execute swap
    const swapResult: any = await execute(); // Force any to ignore TS misidentifying SwapResult type

    if (swapResult.error) {
      console.log(swapResult.error);
    } else {
      console.log(`https://explorer.solana.com/tx/${swapResult.txid}`);
      console.log(
        `inputAddress=${swapResult.inputAddress.toString()} outputAddress=${swapResult.outputAddress.toString()}`,
      );
      console.log(
        `inputAmount=${swapResult.inputAmount} outputAmount=${swapResult.outputAmount}`,
      );
    }
  }
}
