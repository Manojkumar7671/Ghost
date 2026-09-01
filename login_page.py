import getpass
username = input('Enter username: ')
password = getpass.getpass('Enter password: ')
if username == 'manu' and password == 'manoj':
    print('Login successful')
else:
    print('Invalid credentials')
