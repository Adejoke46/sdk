import type { Meta, StoryObj } from '@storybook/react';
import { useCreateTip } from './useCreateTip';
import { DorisioProvider } from './DorisioProvider';

const meta: Meta<typeof UseCreateTipStory> = {
  title: 'Hooks/useCreateTip',
  component: UseCreateTipStory,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof UseCreateTipStory>;

function UseCreateTipStory() {
  const { createTip, buildTransaction, submitTransaction, confirmTransaction, state, reset } =
    useCreateTip();

  const handleFullWorkflow = async () => {
    try {
      // Step 1: Create tip
      const tip = await createTip({
        creatorId: 'creator-123',
        amount: 100,
        message: 'Great content!',
      });
      console.log('Tip created:', tip);

      // Step 2: Build transaction
      const { transactionEnvelope } = await buildTransaction(tip.id, {
        senderPublicKey: 'sender-public-key',
        creatorPublicKey: 'creator-public-key',
        amount: '100',
      });
      console.log('Transaction built');

      // Step 3: Submit transaction
      await submitTransaction(tip.id, transactionEnvelope);
      console.log('Transaction submitted');

      // Step 4: Confirm transaction
      const confirmed = await confirmTransaction(tip.id);
      console.log('Transaction confirmed:', confirmed);
    } catch (error) {
      console.error('Workflow failed:', error);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h2>useCreateTip Hook</h2>
      <div style={{ marginBottom: '20px' }}>
        <strong>State:</strong> {state.step}
      </div>
      <div style={{ marginBottom: '20px' }}>
        <strong>Loading:</strong> {state.loading ? 'Yes' : 'No'}
      </div>
      {state.error && (
        <div style={{ marginBottom: '20px', color: 'red' }}>
          <strong>Error:</strong> {state.error}
        </div>
      )}
      {state.data && (
        <div style={{ marginBottom: '20px' }}>
          <strong>Tip ID:</strong> {state.data.id}
        </div>
      )}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={handleFullWorkflow}
          disabled={state.loading}
          style={{
            padding: '10px 20px',
            backgroundColor: state.loading ? '#ccc' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: state.loading ? 'not-allowed' : 'pointer',
          }}
        >
          Full Workflow
        </button>
        <button
          onClick={reset}
          style={{
            padding: '10px 20px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

export const Default: Story = {
  decorators: [
    (Story) => (
      <DorisioProvider
        config={{
          baseUrl: 'https://api.example.com',
          mode: 'sandbox',
        }}
      >
        <Story />
      </DorisioProvider>
    ),
  ],
};

export const LoadingState: Story = {
  decorators: [
    (Story) => (
      <DorisioProvider
        config={{
          baseUrl: 'https://api.example.com',
          mode: 'sandbox',
        }}
      >
        <Story />
      </DorisioProvider>
    ),
  ],
};

export const ErrorState: Story = {
  decorators: [
    (Story) => (
      <DorisioProvider
        config={{
          baseUrl: 'https://api.example.com',
          mode: 'sandbox',
        }}
      >
        <Story />
      </DorisioProvider>
    ),
  ],
};
