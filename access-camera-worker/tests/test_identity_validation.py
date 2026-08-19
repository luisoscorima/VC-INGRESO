import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from identity_validation import is_valid_document, is_valid_plate, normalize_document, normalize_plate


class IdentityValidationTests(unittest.TestCase):
    def test_peruvian_plates(self):
        for value in ("ABC123", "ABC-123", "AB-1234"):
            self.assertTrue(is_valid_plate(value))
            self.assertEqual(6, len(normalize_plate(value)))
        for value in ("ABC12", "ABC1234", "ABC.123", "ABC/123", "ABC_123", "ABÑ123"):
            self.assertFalse(is_valid_plate(value))

    def test_documents(self):
        self.assertTrue(is_valid_document("DNI", "12345678"))
        self.assertFalse(is_valid_document("DNI", "1234567"))
        self.assertEqual("AB1234567", normalize_document("CE", " ab1234567 "))
        self.assertTrue(is_valid_document("CE", "ab1234567"))
        self.assertTrue(is_valid_document("CE", "123456789"))
        self.assertTrue(is_valid_document("CE", "N12345678"))
        self.assertFalse(is_valid_document("CE", "ab12345"))
        self.assertFalse(is_valid_document("CE", "12345678"))
        self.assertFalse(is_valid_document("CE", "ABC-123"))


if __name__ == "__main__":
    unittest.main()
