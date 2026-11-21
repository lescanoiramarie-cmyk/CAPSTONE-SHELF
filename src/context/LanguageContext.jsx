import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './useAuth.js';

const LanguageContext = createContext(null);

const FILIPINO = {
  'Preferred language': 'Piniling wika',
  'Choose the language you prefer for SHELF.': 'Piliin ang wikang gusto mong gamitin sa SHELF.',
  'This preference is saved on this device.': 'Nase-save ang pagpiling ito sa device na ito.',
  'Manage your dashboard preference and review your account access.': 'Pamahalaan ang kagustuhan sa dashboard at suriin ang access sa iyong account.',
  'Manage your account security, terms documents, and dashboard preferences.': 'Pamahalaan ang seguridad ng account, mga tuntunin, at mga kagustuhan sa dashboard.',
  'Open this page when I sign in': 'Buksan ang pahinang ito kapag nag-sign in ako',
  'This preference is saved on this device and used on your next sign-in.': 'Nase-save ang kagustuhang ito sa device na ito at gagamitin sa susunod mong pag-sign in.',
  'Sub-admin sign-ins require an authenticator code. During setup, scan the same QR code on each phone you want to use.': 'Nangangailangan ng authenticator code ang pag-sign in ng sub-admin. Sa pag-setup, i-scan ang parehong QR code sa bawat teleponong gagamitin mo.',
  'Super Admin sign-ins require an authenticator code. You can update your password here.': 'Nangangailangan ng authenticator code ang pag-sign in ng Super Admin. Maaari mong palitan dito ang iyong password.',
  'My Profile': 'Aking Profile',
  'Visitor Menu': 'Menu ng Visitor',
  'Dashboard': 'Dashboard',
  'Back to dashboard': 'Bumalik sa Dashboard',
  'Close': 'Isara',
  'Remove photo': 'Alisin ang larawan',
  'Click to view full photo': 'I-click para makita ang buong larawan',
  'Change profile photo': 'Palitan ang larawan sa profile',
  'Change': 'Palitan',
  'Visitor': 'Visitor',
  'JPG, PNG, or WEBP up to 2 MB': 'JPG, PNG, o WEBP na hanggang 2 MB',
  'Visitor pass': 'Pass ng Visitor',
  'Library QR Pass': 'QR Pass ng Library',
  'Show this code at the library desk.': 'Ipakita ang code na ito sa library desk.',
  'QR code is refreshing…': 'Nire-refresh ang QR code…',
  'Library console': 'Console ng Library',
  'System console': 'Console ng System',
  'Terms and Conditions': 'Mga Tuntunin at Kundisyon',
  'Overview & analytics': 'Buod at Analytics',
  'Updating…': 'Nag-a-update…',
  'Settings': 'Mga Setting',
  'Personal Information': 'Personal na Impormasyon',
  'Account security': 'Seguridad ng Account',
  'Administrator account': 'Account ng Administrator',
  'Dashboard preferences': 'Mga Kagustuhan sa Dashboard',
  'Name': 'Pangalan',
  'Email': 'Email',
  'Contact number': 'Numero ng Contact',
  'Address': 'Address',
  'Full name': 'Buong Pangalan',
  'Cancel': 'Kanselahin',
  'Save': 'I-save',
  'Saving…': 'Sine-save…',
  'Edit profile': 'I-edit ang Profile',
  'Update password': 'I-update ang Password',
  'New password': 'Bagong Password',
  'Confirm password': 'Kumpirmahin ang Password',
  'At least 12 characters, with uppercase and lowercase letters, a number, and a symbol.': 'Dapat ay hindi bababa sa 12 character, may malaking at maliit na titik, numero, at simbolo.',
  'Assigned library': 'Nakatalagang Library',
  'Not assigned': 'Walang nakatalagang Library',
  'Not available': 'Hindi available',
  'Assigned Branch Overview': 'Buod ng Nakatalagang Sangay',
  'Library profile details and system assignment for this console.': 'Mga detalye ng library at pagtatalaga sa system para sa console na ito.',
  'Branch Name': 'Pangalan ng Sangay',
  'Branch ID': 'ID ng Sangay',
  'System Role': 'Role sa System',
  'Sub-Administrator': 'Sub-Administrator',
  'Choose a JPG, PNG, or WEBP image for your profile photo.': 'Pumili ng JPG, PNG, o WEBP na larawan para sa iyong profile.',
  'Profile photos must be 2 MB or smaller.': 'Dapat 2 MB o mas maliit ang larawan sa profile.',
  'Your profile was updated successfully.': 'Matagumpay na na-update ang iyong profile.',
  'Your profile was saved. Refresh the dashboard to see the latest information.': 'Na-save ang iyong profile. I-refresh ang dashboard para makita ang pinakabagong impormasyon.',
  'Visitor Accounts': 'Mga Visitor Account',
  'Overview': 'Buod',
  'Inventory': 'Imbentaryo',
  'Attendance': 'Pagdalo',
  'Book Transactions': 'Mga Transaksyon ng Aklat',
  'Fine Payments': 'Mga Bayad sa Multa',
  'Plan & Subscription': 'Plano at Subscription',
  'Reservation Queue': 'Pila ng mga Reservation',
  'Branch Map': 'Mapa ng Sangay',
  'Libraries & map': 'Mga Library at Mapa',
  'Staff accounts': 'Mga Staff Account',
  'Visitor accounts': 'Mga Visitor Account',
  'Subscriptions': 'Mga Subscription',
  'Sign in': 'Mag-sign in',
  'Sign out': 'Mag-sign out',
  'Search': 'Maghanap',
  'Loading…': 'Naglo-load…',
  'No results found.': 'Walang nahanap na resulta.',
  'Available': 'Available',
  'Pending': 'Nakabinbin',
  'Approved': 'Naaprubahan',
  'Rejected': 'Tinanggihan',
  'Confirm': 'Kumpirmahin',
  'Approve': 'Aprubahan',
  'Reject': 'Tanggihan',
  'Announcements': 'Mga Anunsyo',
  'Feedback': 'Feedback',
  'Reports': 'Mga Ulat',
  'Analytics': 'Analytics',
  'Notifications': 'Mga Notification',
  'Mark all read': 'Markahang nabasa lahat',
  'No notifications': 'Walang notification',
  'Sub-Admin Dashboard': 'Dashboard ng Sub-Admin',
  'Super Admin Dashboard': 'Dashboard ng Super Admin',
  'Your library:': 'Iyong library:',
  'Search books, check availability, manage requests, and keep track of your library visits.': 'Maghanap ng mga libro, tingnan ang availability, pamahalaan ang mga request, at subaybayan ang iyong mga pagbisita sa library.',
  'Search Catalog': 'Maghanap sa Catalog',
  'View Fines': 'Tingnan ang mga Multa',
  'Catalog': 'Catalog',
  'Book Categories': 'Mga Kategorya ng Libro',
  'Community Books': 'Mga Community Book',
  'Saved Books': 'Mga Naka-save na Libro',
  'My Personal Books': 'Aking mga Personal na Libro',
  'My Reading List': 'Aking Reading List',
  'My Requests & Borrows': 'Aking mga Request at Hiram',
  'Library Map': 'Mapa ng mga Library',
  'Announcements & Feedback': 'Mga Anunsyo at Feedback',
  'This Week': 'Ngayong Linggo',
  'Last Week': 'Nakaraang Linggo',
  'This Month': 'Ngayong Buwan',
  'Last Month': 'Nakaraang Buwan',
  'All Time': 'Lahat ng Panahon',
  'Visits': 'Mga Pagbisita',
  'Due today': 'Due ngayong araw',
  'Due soon': 'Malapit nang due',
  'Reports & services': 'Mga Ulat at Serbisyo',
  'Communication': 'Komunikasyon',
  'All libraries': 'Lahat ng Library',
  'Go to SHELF home': 'Pumunta sa SHELF home',
  'Public Catalog Search': 'Pampublikong Paghahanap sa Catalog',
  'Back to home': 'Bumalik sa home',
  'Search community books...': 'Maghanap ng community book...',
  'Search catalog': 'Maghanap sa catalog',
  'Sort catalog books': 'Ayusin ang mga libro sa catalog',
  'Filter by library': 'I-filter ayon sa library',
  'Filter by availability status': 'I-filter ayon sa availability',
  'Rows per page': 'Mga row bawat page',
  'Quick guide': 'Mabilis na Gabay',
  'How to request and borrow a book': 'Paano mag-request at humiram ng libro',
  'Find a book': 'Maghanap ng libro',
  'Search the catalog and open a title to check its library and availability.': 'Maghanap sa catalog at buksan ang pamagat para tingnan ang library at availability nito.',
  'Send your request': 'Ipadala ang iyong request',
  'Choose Borrow if a copy is available, or Reserve to join the queue.': 'Piliin ang Humiram kung may kopyang available, o Magpa-reserve para sumali sa pila.',
  'Track the status': 'Subaybayan ang status',
  'Open My Requests & Borrows to see updates. Community book requests need owner approval.': 'Buksan ang Aking mga Request at Hiram para makita ang mga update. Kailangan ng pahintulot ng may-ari para sa mga request ng community book.',
  'Pick it up': 'Kunin ang libro',
  'When it is ready, visit the library before the pickup deadline and show your visitor QR pass.': 'Kapag handa na, pumunta sa library bago ang takdang oras ng pagkuha at ipakita ang iyong visitor QR pass.',
  'Location Map': 'Mapa ng Lokasyon',
  'Close map': 'Isara ang mapa',
  'Search by Title, Author, ISBN, or Category...': 'Maghanap ayon sa Pamagat, May-akda, ISBN, o Kategorya...',
  'Search by title, author, category, or ISBN...': 'Maghanap ayon sa pamagat, may-akda, kategorya, o ISBN...',
  'All categories': 'Lahat ng Kategorya',
  'All statuses': 'Lahat ng Status',
  'Title (A-Z)': 'Pamagat (A-Z)',
  'Title (Z-A)': 'Pamagat (Z-A)',
  'Author (A-Z)': 'May-akda (A-Z)',
  'Author (Z-A)': 'May-akda (Z-A)',
  'Search title, author, category, or ISBN...': 'Maghanap ayon sa pamagat, may-akda, kategorya, o ISBN...',
  'Search community books…': 'Maghanap ng community book…',
  'Search title, author, category, or ISBN': 'Maghanap ayon sa pamagat, may-akda, kategorya, o ISBN',
  'Search by book or requester': 'Maghanap ayon sa libro o nag-request',
  'Search by book or owner': 'Maghanap ayon sa libro o may-ari',
  'Requests by status': 'Mga Request ayon sa Status',
  'Requests over the last 6 months': 'Mga Request sa Nakaraang 6 na Buwan',
  'Book cover input method': 'Paraan ng paglagay ng cover ng libro',
  'Enter book title': 'Ilagay ang pamagat ng libro',
  'Author name': 'Pangalan ng may-akda',
  'Enter a custom category': 'Ilagay ang sariling kategorya',
  'Brief description of the book': 'Maikling paglalarawan ng libro',
  'Add a short message for the requester.': 'Magdagdag ng maikling mensahe para sa nag-request.',
  'Write your review or thoughts about this book...': 'Isulat ang iyong review o saloobin tungkol sa librong ito...',
  'Public': 'Pampubliko',
  'Only Me': 'Ako Lamang',
  'All requests': 'Lahat ng Request',
  'Pending approval': 'Naghihintay ng pag-apruba',
  'To confirm': 'Kailangang kumpirmahin',
  'Borrowed': 'Nahiram',
  'Returned': 'Naibalik',
  'Cancelled': 'Kinansela',
  'Expired (Not Picked Up)': 'Nag-expire (Hindi nakuha)',
  'New': 'Bago',
  'Like New': 'Parang Bago',
  'Good': 'Maayos',
  'Fair': 'Katamtaman',
  'Poor': 'Hindi maayos',
  'Total requests': 'Kabuuang Request',
  'Waiting': 'Naghihintay',
  'Fine due': 'Multang babayaran',
  'Book Title': 'Pamagat ng Libro',
  'Status': 'Status',
  'Details': 'Mga Detalye',
  'Action': 'Aksyon',
  'Fine (PHP)': 'Multa (PHP)',
  'Catalog pagination': 'Mga pahina ng catalog',
  'My request pages': 'Mga pahina ng aking mga request',
  'Personal book pages': 'Mga pahina ng personal books',
  'Personal book': 'Personal na libro',
  'Untitled Book': 'Walang pamagat na libro',
  'Close book information': 'Isara ang impormasyon ng libro',
  'Book rating': 'Rating ng libro',
  'Sign In Required': 'Kailangan Mag-sign In',
  'Browse OPAC (sign-in required)': 'Buksan ang OPAC (kailangan mag-sign in)',
  'Browse OPAC catalog (sign-in required)': 'Buksan ang OPAC catalog (kailangan mag-sign in)',
  'All': 'Lahat',
  'Clear': 'I-clear',
  'Saved': 'Naka-save',
  'Read later': 'Basahin Mamaya',
  'View book details': 'Tingnan ang detalye ng libro',
  'Make': 'Gawing',
  'private': 'pribado',
  'public': 'pampubliko',
  'Edit': 'I-edit',
  'Remove': 'Alisin',
  'Reservation update': 'Update sa Reservation',
  'Unable to complete action': 'Hindi nakumpleto ang aksyon',
  'Action completed': 'Nakumpleto ang aksyon',
  'Library update': 'Update sa Library',
  'Close notification': 'Isara ang notification',
  'Close announcement': 'Isara ang anunsyo',
  'Dismiss community request error': 'Isara ang error sa community request',
  'Dismiss community request update': 'Isara ang update sa community request',
  'Save pass': 'I-save ang pass',
};

function readLanguage(user) {
  try {
    const userId = user?.id || 'anonymous';
    const current = window.localStorage.getItem(`shelf_language_${userId}`);
    if (current === 'fil' || current === 'en') return current;

    // Migrate language choices saved by the earlier role-specific selector.
    if (user?.id) {
      const roleKey = user.role === 'superadmin'
        ? `shelf_language_superadmin_${userId}`
        : user.role === 'subadmin'
          ? `shelf_language_subadmin_${userId}`
          : `shelf_language_visitor_${userId}`;
      const legacy = window.localStorage.getItem(roleKey);
      if (legacy === 'fil' || legacy === 'en') {
        window.localStorage.setItem(`shelf_language_${userId}`, legacy);
        return legacy;
      }
    }
    return 'en';
  } catch {
    return 'en';
  }
}

export function LanguageProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id || 'anonymous';
  const [language, setLanguageState] = useState(() => readLanguage(user));

  useEffect(() => {
    setLanguageState(readLanguage(user));
  }, [userId, user?.role]);

  useEffect(() => {
    document.documentElement.lang = language === 'fil' ? 'fil' : 'en';
  }, [language]);

  const setLanguage = useCallback((nextLanguage) => {
    const normalized = nextLanguage === 'fil' ? 'fil' : 'en';
    setLanguageState(normalized);
    try {
      window.localStorage.setItem(`shelf_language_${userId}`, normalized);
    } catch {
      // Keep the selection for this session if browser storage is unavailable.
    }
  }, [userId]);

  const t = useCallback((text) => (
    language === 'fil' ? (FILIPINO[text] || text) : text
  ), [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within a LanguageProvider');
  return context;
}
