import { DorisioClient } from '../../client';
import * as BalanceMethods from '../../client/balance';
import * as HistoryMethods from '../../client/history';
import * as TransactionMethods from '../../client/transactions';
import * as VerificationMethods from '../../client/verification';
import { StatefulMockHttp } from './mock-http';

export interface IntegrationClientBundle {
  client: DorisioClient;
  http: StatefulMockHttp;
}

export function createIntegrationClient(): IntegrationClientBundle {
  const http = new StatefulMockHttp();

  const client = {
    request: http.request,
  } as unknown as DorisioClient;

  client.createTip = TransactionMethods.createTip.bind(client);
  client.buildPaymentTransaction = TransactionMethods.buildPaymentTransaction.bind(client);
  client.submitPaymentTransaction = TransactionMethods.submitPaymentTransaction.bind(client);
  client.checkTransactionConfirmation =
    TransactionMethods.checkTransactionConfirmation.bind(client);
  client.getTransactionHistory = TransactionMethods.getTransactionHistory.bind(client);

  client.requestWalletVerificationChallenge =
    VerificationMethods.requestWalletVerificationChallenge.bind(client);
  client.verifyWallet = VerificationMethods.verifyWallet.bind(client);
  client.getWalletBalance = BalanceMethods.getWalletBalance.bind(client);

  client.requestCreatorVerification =
    VerificationMethods.requestCreatorVerification.bind(client);
  client.getCreatorVerificationStatus =
    VerificationMethods.getCreatorVerificationStatus.bind(client);
  client.getCreatorEarnings = HistoryMethods.getCreatorEarnings.bind(client);
  client.canPayout = BalanceMethods.canPayout.bind(client);
  client.getCreatorPendingPayout = BalanceMethods.getCreatorPendingPayout.bind(client);

  return { client, http };
}
