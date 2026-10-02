import { useState, useEffect } from 'react';
import { supabase } from "../lib/supabaseClient.js";

async function loadBooksForVisitor(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('personal_books')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export default function PersonalBooks({ userId: propUserId }) {
  const [books, setBooks] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(propUserId || null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [privacyStatus, setPrivacyStatus] = useState('private');
  const [listingType, setListingType] = useState('none');
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // 1. Kumuha at mag-check ng Active Authenticated User Session
  useEffect(() => {
    async function resolveUser() {
      if (propUserId) {
        setCurrentUserId(propUserId);
        return;
      }
      
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      } else {
        setError('No active user session found. Please log in.');
      }
    }
    resolveUser();
  }, [propUserId]);

  // 2. Load books tuwing may valid na currentUserId
  useEffect(() => {
    let active = true;
    if (!currentUserId) return;

    loadBooksForVisitor(currentUserId)
      .then((rows) => {
        if (active) setBooks(rows);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'Unable to load personal books.');
      });

    return () => {
      active = false;
    };
  }, [currentUserId]);

  // 3. Handle Add Book (Ligtas laban sa Null Foreign Keys)
  const handleAddBook = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    // Verify User Session bago mag-insert
    let activeUserId = currentUserId;
    if (!activeUserId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        activeUserId = user.id;
        setCurrentUserId(user.id);
      } else {
        setError('User is not authenticated. Cannot save book.');
        return;
      }
    }

    if (privacyStatus === 'public' && listingType === 'sell' && (parseFloat(price) <= 0 || !price)) {
      setError('Please enter a valid selling price greater than 0.');
      return;
    }

    setLoading(true);

    // Dynamic Insert Payload (I-i-insert lang ang owner_id kapag tiyak na may valid ID)
    const payload = {
      title,
      author,
      privacy_status: privacyStatus,
      listing_type: privacyStatus === 'public' ? listingType : 'none',
      price: listingType === 'sell' && privacyStatus === 'public' ? parseFloat(price) : 0,
    };

    if (activeUserId) {
      payload.owner_id = activeUserId;
    }

    const { error: insertError } = await supabase
      .from('personal_books')
      .insert([payload]);

    setLoading(false);

    if (insertError) {
      setError('Error adding book: ' + insertError.message);
    } else {
      setMessage('Book added successfully.');
      setTitle('');
      setAuthor('');
      setPrivacyStatus('private');
      setListingType('none');
      setPrice('');
      setBooks(await loadBooksForVisitor(activeUserId));
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '15px' }}>
        Add Personal Book
      </h2>
      {error && <p role="alert" style={{ border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', padding: '10px' }}>{error}</p>}
      {message && <p role="status" style={{ border: '1px solid #a7f3d0', background: '#ecfdf5', color: '#065f46', padding: '10px' }}>{message}</p>}
      
      <form onSubmit={handleAddBook} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '30px' }}>
        <input 
          type="text" 
          placeholder="Book Title" 
          value={title} 
          onChange={(e) => setTitle(e.target.value)} 
          required 
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
        />
        <input 
          type="text" 
          placeholder="Author" 
          value={author} 
          onChange={(e) => setAuthor(e.target.value)} 
          required 
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
        />

        <div>
          <label style={{ display: 'block', fontWeight: '500', marginBottom: '4px' }}>
            Privacy Setting:
          </label>
          <select 
            value={privacyStatus} 
            onChange={(e) => setPrivacyStatus(e.target.value)}
            style={{ padding: '8px', width: '100%', borderRadius: '4px', border: '1px solid #ccc' }}
          >
            <option value="private">Private (Only Me)</option>
            <option value="public">Public (Visible to Community)</option>
          </select>
        </div>

        {privacyStatus === 'public' && (
          <div>
            <label style={{ display: 'block', fontWeight: '500', marginBottom: '4px' }}>
              Sharing Option:
            </label>
            <select 
              value={listingType} 
              onChange={(e) => setListingType(e.target.value)}
              style={{ padding: '8px', width: '100%', borderRadius: '4px', border: '1px solid #ccc' }}
            >
              <option value="none">Display Only (Public Reading List)</option>
              <option value="lend">Lend to Other Visitors</option>
              <option value="sell">Sell to Other Visitors</option>
            </select>

            {listingType === 'sell' && (
              <input 
                type="number" 
                min="0"
                step="0.01"
                placeholder="Selling Price (₱)" 
                value={price} 
                onChange={(e) => {
                  const val = e.target.value;
                  setPrice(val === '' ? '' : Math.max(0, parseFloat(val)));
                }} 
                required
                style={{ padding: '8px', marginTop: '8px', width: '100%', borderRadius: '4px', border: '1px solid #ccc' }}
              />
            )}
          </div>
        )}

        <button 
          type="submit" 
          disabled={loading}
          style={{ padding: '10px', backgroundColor: '#0284c7', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          {loading ? 'Saving...' : 'Add Book'}
        </button>
      </form>

      <hr style={{ margin: '20px 0' }} />

      <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px' }}>
        My Personal Books Collection
      </h3>
      {books.length === 0 ? (
        <p>No personal books added yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {books.map((b) => (
            <div key={b.id} style={{ border: '1px solid #ddd', padding: '12px', borderRadius: '6px' }}>
              <h4 style={{ margin: '0 0 4px 0' }}>{b.title}</h4>
              <p style={{ margin: '0 0 6px 0', color: '#555' }}>by {b.author}</p>
              <span style={{ fontSize: '12px', padding: '2px 6px', backgroundColor: b.privacy_status === 'public' ? '#dcfce7' : '#f3f4f6', borderRadius: '4px' }}>
                {b.privacy_status ? b.privacy_status.toUpperCase() : 'PRIVATE'}
              </span>
              {b.privacy_status === 'public' && b.listing_type !== 'none' && (
                <span style={{ fontSize: '12px', marginLeft: '8px', padding: '2px 6px', backgroundColor: '#e0f2fe', borderRadius: '4px' }}>
                  {b.listing_type === 'lend' ? 'Available for Lend' : `For Sale: ₱${b.price}`}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}