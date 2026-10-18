import type { Meta, StoryObj } from '@storybook/react';
import { useTransactionHistory } from './useTransactionHistory';
import { DorisioProvider } from './DorisioProvider';

const meta: Meta<typeof UseTransactionHistoryStory> = {
  title: 'Hooks/useTransactionHistory',
  component: UseTransactionHistoryStory,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof UseTransactionHistoryStory>;

function UseTransactionHistoryStory() {
  const {
    transactions,
    total,
    page,
    pageSize,
    loading,
    error,
    lastUpdated,
    fetchHistory,
    nextPage,
    prevPage,
    setPageSize,
    refetch,
    reset,
  } = useTransactionHistory({ page: 1, pageSize: 10 });

  const handleFetchHistory = async () => {
    try {
      await fetchHistory({ page: 1, pageSize: 10 });
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  const handleNextPage = async () => {
    try {
      await nextPage();
    } catch (err) {
      console.error('Failed to go to next page:', err);
    }
  };

  const handlePrevPage = async () => {
    try {
      await prevPage();
    } catch (err) {
      console.error('Failed to go to previous page:', err);
    }
  };

  const handleSetPageSize = async (size: number) => {
    try {
      await setPageSize(size);
    } catch (err) {
      console.error('Failed to set page size:', err);
    }
  };

  const handleRefetch = async () => {
    try {
      await refetch();
    } catch (err) {
      console.error('Failed to refetch:', err);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h2>useTransactionHistory Hook</h2>
      <div style={{ marginBottom: '20px' }}>
        <strong>Loading:</strong> {loading ? 'Yes' : 'No'}
      </div>
      <div style={{ marginBottom: '20px' }}>
        <strong>Page:</strong> {page} / {Math.ceil(total / pageSize) || 1}
      </div>
      <div style={{ marginBottom: '20px' }}>
        <strong>Page Size:</strong> {pageSize}
      </div>
      <div style={{ marginBottom: '20px' }}>
        <strong>Total:</strong> {total}
      </div>
      {error && (
        <div style={{ marginBottom: '20px', color: 'red' }}>
          <strong>Error:</strong> {error}
        </div>
      )}
      {lastUpdated && (
        <div style={{ marginBottom: '20px' }}>
          <strong>Last Updated:</strong> {new Date(lastUpdated).toLocaleString()}
        </div>
      )}
      <div style={{ marginBottom: '20px' }}>
        <strong>Transactions:</strong> {transactions.length}
      </div>
      {transactions.length > 0 && (
        <div style={{ marginBottom: '20px', maxHeight: '200px', overflowY: 'auto' }}>
          {transactions.map((tx) => (
            <div key={tx.id} style={{ padding: '8px', borderBottom: '1px solid #eee' }}>
              <div>
                <strong>ID:</strong> {tx.id}
              </div>
              <div>
                <strong>Amount:</strong> {tx.amount}
              </div>
              <div>
                <strong>Status:</strong> {tx.status}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button
          onClick={handleFetchHistory}
          disabled={loading}
          style={{
            padding: '10px 20px',
            backgroundColor: loading ? '#ccc' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          Fetch History
        </button>
        <button
          onClick={handlePrevPage}
          disabled={loading || page <= 1}
          style={{
            padding: '10px 20px',
            backgroundColor: loading || page <= 1 ? '#ccc' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading || page <= 1 ? 'not-allowed' : 'pointer',
          }}
        >
          Previous
        </button>
        <button
          onClick={handleNextPage}
          disabled={loading || page * pageSize >= total}
          style={{
            padding: '10px 20px',
            backgroundColor: loading || page * pageSize >= total ? '#ccc' : '#ffc107',
            color: 'black',
            border: 'none',
            borderRadius: '4px',
            cursor: loading || page * pageSize >= total ? 'not-allowed' : 'pointer',
          }}
        >
          Next
        </button>
        <button
          onClick={() => handleSetPageSize(20)}
          disabled={loading}
          style={{
            padding: '10px 20px',
            backgroundColor: loading ? '#ccc' : '#17a2b8',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          Set Size 20
        </button>
        <button
          onClick={handleRefetch}
          disabled={loading}
          style={{
            padding: '10px 20px',
            backgroundColor: loading ? '#ccc' : '#6f42c1',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          Refetch
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

export const WithTransactions: Story = {
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

export const Pagination: Story = {
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
